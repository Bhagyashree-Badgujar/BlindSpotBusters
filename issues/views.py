import json

from django.contrib.auth.models import User
from django.db.models import Count, F, Max
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from users.models import UserProfile

from .models import Issue, IssueMedia, IssueVote


def api_login_required(view):
    def wrap(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required'}, status=401)
        return view(request, *args, **kwargs)

    return wrap


KEYWORD_TO_CATEGORY = {
    'potholes': ('potholes', ['pothole', 'potholes', 'road', 'crack', 'asphalt', 'bump']),
    'garbage': ('garbage', ['garbage', 'trash', 'litter', 'waste', 'dump', 'debris']),
    'streetlight': (
        'streetlight',
        ['streetlight', 'street light', 'lamp post', 'dark street', 'light pole', 'lamp'],
    ),
    'water': ('water', ['water', 'leak', 'flooding', 'drain', 'sewage', 'pipe']),
}


HIGH_PRIORITY_KEYS = [
    'urgent',
    'emergency',
    'danger',
    'accident',
    'flood',
    'electrocution',
    'collapsed',
    'injury',
]


def classify_category_from_text(text):
    t = (text or '').lower()
    for _key, (cat, keys) in KEYWORD_TO_CATEGORY.items():
        if any(k in t for k in keys):
            return cat
    return 'others'


def classify_priority_from_text(text, nearby_dup, title_dup):
    t = (text or '').lower()
    if any(k in t for k in HIGH_PRIORITY_KEYS):
        return 'high'
    if nearby_dup or title_dup:
        return 'high'
    if len(t) > 280:
        return 'medium'
    return 'medium'


def _guess_media_type(filename, content_type):
    n = (filename or '').lower()
    ct = (content_type or '').lower()
    if ct.startswith('video'):
        return 'video'
    if ct.startswith('audio'):
        return 'audio'
    if n.endswith(('.mp4', '.webm', '.mov', '.mkv')):
        return 'video'
    if n.endswith(('.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac')):
        return 'audio'
    return 'image'


def _media_list(issue, request):
    out = []
    for m in issue.extra_media.all():
        url = m.file.url if m.file else ''
        if url and request and not url.startswith('http'):
            url = request.build_absolute_uri(url)
        out.append({'url': url, 'type': m.media_type})
    return out


def _issue_dict(issue, request):
    before = issue.before_img.url if issue.before_img else ''
    after = issue.after_img.url if issue.after_img else ''
    if before and request and not before.startswith('http'):
        before = request.build_absolute_uri(before)
    if after and request and not after.startswith('http'):
        after = request.build_absolute_uri(after)

    user_voted = False
    if request.user.is_authenticated:
        user_voted = IssueVote.objects.filter(user=request.user, issue=issue).exists()

    rr = issue.recent_nearby_count()
    score = (issue.votes * 2) + (rr * 3)
    trending = score >= 18

    return {
        'id': issue.id,
        'title': issue.title,
        'description': issue.description,
        'status': issue.status,
        'votes': issue.votes,
        'recent_reports': rr,
        'impact_score': score,
        'trending': trending,
        'category': issue.category,
        'priority': issue.priority,
        'department': issue.department,
        'created_at': issue.created_at.isoformat() if issue.created_at else None,
        'updated_at': issue.created_at.isoformat() if issue.created_at else None,
        'lat': issue.lat,
        'lng': issue.lng,
        'before_img': before,
        'after_img': after,
        'media': _media_list(issue, request),
        'user': issue.user.username if issue.user_id else '',
        'user_id': issue.user_id,
        'user_voted': user_voted,
        'is_duplicate': False,
    }


def user_issues(request):
    qs = Issue.objects.select_related('user').prefetch_related('extra_media').all()
    if request.GET.get('mine') == 'true':
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required'}, status=401)
        qs = qs.filter(user=request.user)
    data = [_issue_dict(i, request) for i in qs]
    return JsonResponse(data, safe=False)


def issue_detail(request, id):
    try:
        issue = Issue.objects.select_related('user').prefetch_related('extra_media').get(id=id)
        d = _issue_dict(issue, request)
        return JsonResponse(d)
    except Issue.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)


@csrf_exempt
@api_login_required
def issue_vote(request, id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    try:
        issue = Issue.objects.get(id=id)
    except Issue.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)

    if IssueVote.objects.filter(user=request.user, issue=issue).exists():
        return JsonResponse(
            {
                'error': 'You already upvoted this issue',
                'votes': issue.votes,
                'user_voted': True,
            },
            status=400,
        )

    IssueVote.objects.create(user=request.user, issue=issue)
    Issue.objects.filter(pk=issue.pk).update(votes=F('votes') + 1)
    issue.refresh_from_db(fields=['votes'])
    rr = issue.recent_nearby_count()
    return JsonResponse(
        {
            'votes': issue.votes,
            'user_voted': True,
            'impact_score': (issue.votes * 2) + (rr * 3),
        }
    )


@csrf_exempt
@api_login_required
@require_http_methods(['POST'])
def create_issue(request):
    title = (request.POST.get('title') or '').strip()
    description = (request.POST.get('description') or '').strip()
    if not title or not description:
        return JsonResponse({'error': 'Title and description are required'}, status=400)

    lat_raw = request.POST.get('lat') or ''
    lng_raw = request.POST.get('lng') or ''
    lat, lng = None, None
    try:
        if lat_raw.strip():
            lat = float(lat_raw)
        if lng_raw.strip():
            lng = float(lng_raw)
    except (TypeError, ValueError):
        return JsonResponse({'error': 'Invalid coordinates'}, status=400)

    category_in = (request.POST.get('category') or '').strip()
    if category_in in dict(Issue.CATEGORY_CHOICES):
        category = category_in
    else:
        category = classify_category_from_text(description + ' ' + title)

    title_dup = Issue.objects.filter(title__icontains=title[:40]).exists()
    nearby_dup = False
    if lat is not None and lng is not None:
        d = 0.002
        nearby_dup = Issue.objects.filter(
            lat__gte=lat - d,
            lat__lte=lat + d,
            lng__gte=lng - d,
            lng__lte=lng + d,
        ).exists()

    priority = classify_priority_from_text(description + ' ' + title, nearby_dup, title_dup)

    before_img = request.FILES.get('before_img')
    evidence_files = request.FILES.getlist('evidence_files')

    issue = Issue.objects.create(
        user=request.user,
        title=title[:255],
        description=description,
        lat=lat,
        lng=lng,
        before_img=before_img,
        status='pending',
        category=category,
        priority=priority,
    )

    for f in evidence_files:
        if not f:
            continue
        mt = _guess_media_type(f.name, getattr(f, 'content_type', '') or '')
        IssueMedia.objects.create(issue=issue, file=f, media_type=mt)

    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    pts = 20
    if before_img:
        pts += 15
    pts += min(len(evidence_files) * 8, 40)
    profile.civic_points += pts
    badges = list(profile.badges or [])
    if profile.civic_points >= 50 and 'civic_contributor' not in badges:
        badges.append('civic_contributor')
    if profile.civic_points >= 150 and 'civic_champion' not in badges:
        badges.append('civic_champion')
    if before_img and evidence_files and 'evidence_pro' not in badges:
        badges.append('evidence_pro')
    profile.badges = badges
    profile.save(update_fields=['civic_points', 'badges'])

    return JsonResponse(
        {
            'status': 'created',
            'id': issue.id,
            'is_duplicate': title_dup or nearby_dup,
            'ai_category': category,
            'priority': priority,
        }
    )


def check_duplicate(request):
    title = request.GET.get('title', '')
    lat_s, lng_s = request.GET.get('lat'), request.GET.get('lng')
    title_match = Issue.objects.filter(title__icontains=title[:200]).exists() if title else False
    nearby_match = False
    if lat_s and lng_s:
        try:
            la, ln = float(lat_s), float(lng_s)
            d = 0.002
            nearby_match = Issue.objects.filter(
                lat__gte=la - d,
                lat__lte=la + d,
                lng__gte=ln - d,
                lng__lte=ln + d,
            ).exists()
        except (TypeError, ValueError):
            pass
    return JsonResponse(
        {
            'is_duplicate': title_match or nearby_match,
            'title_match': title_match,
            'nearby_match': nearby_match,
        }
    )


def issues_nearby(request):
    lat_s, lng_s = request.GET.get('lat'), request.GET.get('lng')
    if not lat_s or not lng_s:
        return JsonResponse([], safe=False)
    try:
        la, ln = float(lat_s), float(lng_s)
    except (TypeError, ValueError):
        return JsonResponse({'error': 'Invalid coordinates'}, status=400)
    d = 0.004
    qs = (
        Issue.objects.filter(
            lat__gte=la - d,
            lat__lte=la + d,
            lng__gte=ln - d,
            lng__lte=ln + d,
        )
        .order_by('-created_at')[:12]
    )
    return JsonResponse(
        [{'id': i.id, 'title': i.title, 'status': i.status, 'category': i.category} for i in qs],
        safe=False,
    )


@api_login_required
def user_stats(request):
    user = request.user
    profile, _ = UserProfile.objects.get_or_create(user=user)
    total = Issue.objects.filter(user=user).count()
    resolved = Issue.objects.filter(user=user, status='resolved').count()
    pending = Issue.objects.filter(user=user, status='pending').count()
    in_progress = Issue.objects.filter(user=user, status='in_progress').count()
    votes_sum = sum(Issue.objects.filter(user=user).values_list('votes', flat=True) or [])
    by_cat = list(
        Issue.objects.filter(user=user)
        .values('category')
        .annotate(count=Count('id'))
        .order_by('-count')
    )
    return JsonResponse(
        {
            'total': total,
            'resolved': resolved,
            'pending': pending,
            'in_progress': in_progress,
            'upvotes': votes_sum,
            'civic_points': profile.civic_points,
            'badges': profile.badges or [],
            'by_category': by_cat,
        }
    )


def public_stats(request):
    total = Issue.objects.count()
    resolved = Issue.objects.filter(status='resolved').count()
    active = Issue.objects.exclude(status='resolved').count()
    return JsonResponse({'total': total, 'resolved': resolved, 'active': active})


def issues_meta(request):
    """Lightweight poll target for real-time sync (max id + counts)."""
    agg = Issue.objects.aggregate(mx=Max('id'), c=Count('id'))
    return JsonResponse(
        {
            'max_id': agg['mx'] or 0,
            'count': agg['c'] or 0,
            'pending': Issue.objects.filter(status='pending').count(),
            'resolved': Issue.objects.filter(status='resolved').count(),
        }
    )


def leaderboard(request):
    rows = (
        UserProfile.objects.select_related('user')
        .filter(user__is_staff=False)
        .order_by('-civic_points')[:30]
    )
    return JsonResponse(
        [
            {
                'username': p.user.username,
                'points': p.civic_points,
                'badges': p.badges or [],
            }
            for p in rows
        ],
        safe=False,
    )


def _staff_ok(user):
    return user.is_authenticated and user.is_staff


def admin_stats(request):
    if not _staff_ok(request.user):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    by_category = list(Issue.objects.values('category').annotate(count=Count('id')).order_by('-count'))
    by_priority = list(Issue.objects.values('priority').annotate(count=Count('id')).order_by('-count'))
    by_status = list(Issue.objects.values('status').annotate(count=Count('id')))
    return JsonResponse(
        {
            'users': User.objects.filter(is_staff=False).count(),
            'issues': Issue.objects.count(),
            'pending': Issue.objects.filter(status='pending').count(),
            'resolved': Issue.objects.filter(status='resolved').count(),
            'in_progress': Issue.objects.filter(status='in_progress').count(),
            'by_category': by_category,
            'by_priority': by_priority,
            'by_status': by_status,
        }
    )


def admin_issues(request):
    if not _staff_ok(request.user):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    qs = Issue.objects.select_related('user').prefetch_related('extra_media').all()
    data = []
    for issue in qs:
        d = _issue_dict(issue, request)
        d['user'] = issue.user.username if issue.user_id else '—'
        dup = Issue.objects.filter(title__icontains=issue.title[:40]).exclude(pk=issue.pk).exists()
        d['is_duplicate'] = dup
        data.append(d)
    data.sort(key=lambda x: (-x['impact_score'], -x['id']))
    return JsonResponse(data, safe=False)


@csrf_exempt
def admin_issue_update(request, id):
    if not _staff_ok(request.user):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    if request.method != 'PATCH':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    try:
        data = json.loads(request.body or '{}')
        issue = Issue.objects.get(id=id)
        fields = []
        st = data.get('status')
        if st in ('pending', 'in_progress', 'resolved'):
            issue.status = st
            fields.append('status')
        if 'department' in data and isinstance(data.get('department'), str):
            issue.department = (data.get('department') or '')[:120]
            fields.append('department')
        pr = data.get('priority')
        if pr in ('high', 'medium', 'low'):
            issue.priority = pr
            fields.append('priority')
        if fields:
            issue.save(update_fields=fields)
        return JsonResponse({'status': 'updated'})
    except Issue.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)


@csrf_exempt
def admin_issue_after_image(request, id):
    if not _staff_ok(request.user):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    try:
        issue = Issue.objects.get(id=id)
        f = request.FILES.get('after_img')
        if not f:
            return JsonResponse({'error': 'No file'}, status=400)
        issue.after_img = f
        issue.save(update_fields=['after_img'])
        return JsonResponse({'status': 'uploaded'})
    except Issue.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)


def suggest_category(request):
    """GET ?q= description snippet — keyword-based classification."""
    q = request.GET.get('q', '')
    cat = classify_category_from_text(q)
    pr = classify_priority_from_text(q, False, False)
    return JsonResponse({'category': cat, 'priority_hint': pr})
