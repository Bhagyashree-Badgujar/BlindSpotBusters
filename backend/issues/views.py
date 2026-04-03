import json
import math
import re
from datetime import timedelta

from django.contrib.auth.models import User
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.db.models import Q
from django.utils import timezone

from .models import Issue, IssueVote


def api_login_required(view):
    def wrap(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required'}, status=401)
        return view(request, *args, **kwargs)

    return wrap


def _tokenize(text: str):
    tokens = re.findall(r"[a-zA-Z0-9]+", (text or '').lower())
    return [t for t in tokens if len(t) >= 4]


def _title_similarity(a: str, b: str) -> float:
    ta = set(_tokenize(a))
    tb = set(_tokenize(b))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta | tb), 1)


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    # Great-circle distance on a sphere.
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _recent_reports_for_issue(issue: Issue) -> int:
    """
    Recent related reports = similar issues reported within a recent time window and (when available) near the same location.
    This powers the smart Impact Score without heavy ML.
    """
    now = timezone.now()
    since = now - timedelta(days=14)

    base_qs = Issue.objects.filter(created_at__gte=since).exclude(id=issue.id)

    # Narrow candidates by proximity using a rough bounding box, then compute precise distance.
    if issue.lat is not None and issue.lng is not None:
        d = 0.12  # ~13km in degrees (rough but fast).
        base_qs = base_qs.filter(
            lat__gte=issue.lat - d,
            lat__lte=issue.lat + d,
            lng__gte=issue.lng - d,
            lng__lte=issue.lng + d,
        )

    candidates = list(base_qs.only('id', 'title', 'lat', 'lng', 'created_at'))
    similar_count = 0
    dist_threshold_km = 5.0
    sim_threshold = 0.18

    for c in candidates:
        if issue.lat is not None and issue.lng is not None and c.lat is not None and c.lng is not None:
            if _haversine_km(issue.lat, issue.lng, c.lat, c.lng) > dist_threshold_km:
                continue
        if _title_similarity(issue.title, c.title) < sim_threshold:
            continue
        similar_count += 1

    # Include the issue itself as a "recent report".
    return similar_count + 1


def _impact_score(votes: int, recent_reports: int) -> int:
    return (votes or 0) * 2 + (recent_reports or 0) * 3


def _issue_dict(issue: Issue, request, user_voted_ids=None):
    before = issue.before_img.url if issue.before_img else ''
    after = issue.after_img.url if issue.after_img else ''
    if before and request and not before.startswith('http'):
        before = request.build_absolute_uri(before)
    if after and request and not after.startswith('http'):
        after = request.build_absolute_uri(after)

    recent_reports = _recent_reports_for_issue(issue)
    impact_score = _impact_score(issue.votes, recent_reports)

    user_voted = False
    if user_voted_ids is not None:
        user_voted = issue.id in user_voted_ids
    elif request and getattr(request, 'user', None) and request.user.is_authenticated:
        user_voted = IssueVote.objects.filter(user=request.user, issue_id=issue.id).exists()

    reported_at = issue.created_at.isoformat() if issue.created_at else None
    in_progress_at = reported_at if issue.status in ('in_progress', 'resolved') else None
    resolved_at = reported_at if issue.status == 'resolved' else None

    priority = 'resolved'
    if issue.status != 'resolved':
        priority = 'high' if impact_score >= 110 else 'medium' if impact_score >= 55 else 'low'

    return {
        'id': issue.id,
        'title': issue.title,
        'description': issue.description,
        'status': issue.status,
        'votes': issue.votes,
        'recent_reports': recent_reports,
        'impact_score': impact_score,
        'is_duplicate': recent_reports >= 3,  # heuristic for UI alert
        # Trending heuristic: high impact + recency-like signal.
        'is_trending': impact_score >= 120,
        'created_at': issue.created_at.isoformat() if issue.created_at else None,
        'updated_at': issue.created_at.isoformat() if issue.created_at else None,
        'reported_at': reported_at,
        'in_progress_at': in_progress_at,
        'resolved_at': resolved_at,
        'lat': issue.lat,
        'lng': issue.lng,
        'before_img': before,
        'after_img': after,
        'user': issue.user.username if issue.user_id else '',
        'user_id': issue.user_id,
        'user_voted': user_voted,
        'priority': priority,
    }


def user_issues(request):
    qs = Issue.objects.select_related('user').all()
    if request.GET.get('mine') == 'true':
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required'}, status=401)
        qs = qs.filter(user=request.user)
    voted_ids = None
    if request.user.is_authenticated:
        issue_ids = list(qs.values_list('id', flat=True))
        voted_ids = set(
            IssueVote.objects.filter(user=request.user, issue_id__in=issue_ids).values_list('issue_id', flat=True)
        )

    data = [_issue_dict(i, request, user_voted_ids=voted_ids) for i in qs]

    # Trending badge: top ~10% by impact score.
    if data:
        sorted_idx = sorted(range(len(data)), key=lambda k: data[k].get('impact_score', 0), reverse=True)
        top_n = max(1, len(data) // 10)
        top_set = set(sorted_idx[:top_n])
        for idx, d in enumerate(data):
            d['is_trending'] = idx in top_set

    return JsonResponse(data, safe=False)


def issue_detail(request, id):
    try:
        issue = Issue.objects.select_related('user').get(id=id)
        return JsonResponse(_issue_dict(issue, request))
    except Issue.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)


@csrf_exempt
@api_login_required
@require_http_methods(['POST'])
def issue_vote(request, id):
    try:
        issue = Issue.objects.get(id=id)
        vote = IssueVote.objects.filter(user=request.user, issue=issue).first()
        if vote:
            vote.delete()
            user_voted = False
        else:
            IssueVote.objects.create(user=request.user, issue=issue)
            user_voted = True

        # Keep the legacy `Issue.votes` integer consistent with stored votes.
        issue.votes = IssueVote.objects.filter(issue=issue).count()
        issue.save(update_fields=['votes'])

        recent_reports = _recent_reports_for_issue(issue)
        impact_score = _impact_score(issue.votes, recent_reports)

        return JsonResponse({
            'votes': issue.votes,
            'user_voted': user_voted,
            'recent_reports': recent_reports,
            'impact_score': impact_score,
            'is_trending': impact_score >= 120,
        })
    except Issue.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)


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

    before_img = request.FILES.get('before_img')

    dup = Issue.objects.filter(title__icontains=title[:40]).exists()

    issue = Issue.objects.create(
        user=request.user,
        title=title[:255],
        description=description,
        lat=lat,
        lng=lng,
        before_img=before_img,
        status='pending',
    )

    return JsonResponse({
        'status': 'created',
        'id': issue.id,
        'is_duplicate': dup,
    })


def check_duplicate(request):
    title = request.GET.get('title', '')
    exists = Issue.objects.filter(title__icontains=title[:200]).exists()
    return JsonResponse({'is_duplicate': exists})


def nearby_similar_issues(request):
    """
    Nearby + category-like detection (category inferred from title text) to prevent duplicate spam.
    """
    lat_raw = request.GET.get('lat')
    lng_raw = request.GET.get('lng')
    q = request.GET.get('q', '')
    if not lat_raw or not lng_raw or not q:
        return JsonResponse({'issues': []})

    try:
        lat = float(lat_raw)
        lng = float(lng_raw)
    except (TypeError, ValueError):
        return JsonResponse({'issues': []})

    now = timezone.now()
    since = now - timedelta(days=180)
    lat_d = 0.05  # ~5-6km-ish bounding box
    lng_d = 0.05

    # Only consider issues with coordinates and recency to keep it fast.
    qs = Issue.objects.filter(created_at__gte=since).exclude(lat__isnull=True).exclude(lng__isnull=True)
    qs = qs.filter(lat__gte=lat - lat_d, lat__lte=lat + lat_d, lng__gte=lng - lng_d, lng__lte=lng + lng_d)

    target_sim = 0.18
    dist_threshold_km = 3.0
    matches = []
    for c in qs.only('id', 'title', 'description', 'lat', 'lng', 'created_at'):
        if c.lat is None or c.lng is None:
            continue
        dist_km = _haversine_km(lat, lng, c.lat, c.lng)
        if dist_km > dist_threshold_km:
            continue
        sim = max(_title_similarity(q, c.title), _title_similarity(q, c.description))
        if sim < target_sim:
            continue
        matches.append((c, sim, dist_km))

    # Sort by similarity and then build rich dicts for top candidates.
    matches.sort(key=lambda t: t[1], reverse=True)
    top = matches[:10]
    issues = [t[0] for t in top]

    voted_ids = None
    if request.user.is_authenticated and issues:
        issue_ids = [i.id for i in issues]
        voted_ids = set(IssueVote.objects.filter(user=request.user, issue_id__in=issue_ids).values_list('issue_id', flat=True))

    payload = []
    for c, sim, dist_km in top:
        d = _issue_dict(c, request, user_voted_ids=voted_ids)
        d['match_score'] = round(sim, 3)
        d['distance_km'] = round(dist_km, 2)
        payload.append(d)

    return JsonResponse({'issues': payload})


def suggest_similar_issues(request):
    """
    Live duplicate suggestions while the citizen types (keyword similarity).
    """
    text = request.GET.get('text') or request.GET.get('q') or ''
    if not text.strip():
        return JsonResponse({'issues': []})

    lat_raw = request.GET.get('lat')
    lng_raw = request.GET.get('lng')
    lat = lng = None
    if lat_raw and lng_raw:
        try:
            lat = float(lat_raw)
            lng = float(lng_raw)
        except (TypeError, ValueError):
            lat = lng = None

    now = timezone.now()
    since = now - timedelta(days=180)
    qs = Issue.objects.filter(created_at__gte=since).exclude(title__isnull=True).only('id', 'title', 'description', 'lat', 'lng')

    if lat is not None and lng is not None:
        d = 0.25  # bounding to limit candidates (~25km-ish rough)
        qs = qs.filter(lat__gte=lat - d, lat__lte=lat + d, lng__gte=lng - d, lng__lte=lng + d)

    matches = []
    for c in qs:
        sim_title = _title_similarity(text, c.title)
        sim_desc = _title_similarity(text, c.description)
        sim = max(sim_title, sim_desc)
        if sim <= 0.08:
            continue
        if lat is not None and lng is not None and c.lat is not None and c.lng is not None:
            dist_km = _haversine_km(lat, lng, c.lat, c.lng)
            sim = sim / (1 + (dist_km / 6.0))
        matches.append((c, sim))

    matches.sort(key=lambda t: t[1], reverse=True)
    top = matches[:8]
    issues = [t[0] for t in top]

    voted_ids = None
    if request.user.is_authenticated and issues:
        issue_ids = [i.id for i in issues]
        voted_ids = set(IssueVote.objects.filter(user=request.user, issue_id__in=issue_ids).values_list('issue_id', flat=True))

    payload = []
    for c, sim in top:
        d = _issue_dict(c, request, user_voted_ids=voted_ids)
        d['match_score'] = round(sim, 3)
        payload.append(d)

    return JsonResponse({'issues': payload})


@api_login_required
def user_stats(request):
    user = request.user
    total = Issue.objects.filter(user=user).count()
    resolved = Issue.objects.filter(user=user, status='resolved').count()
    pending = Issue.objects.filter(user=user, status='pending').count()
    in_progress = Issue.objects.filter(user=user, status='in_progress').count()
    votes_sum = sum(Issue.objects.filter(user=user).values_list('votes', flat=True) or [])
    return JsonResponse({
        'total': total,
        'resolved': resolved,
        'pending': pending,
        'in_progress': in_progress,
        'upvotes': votes_sum,
    })


def public_stats(request):
    total = Issue.objects.count()
    resolved = Issue.objects.filter(status='resolved').count()
    active = Issue.objects.filter(status__in=['pending', 'in_progress']).count()
    return JsonResponse({
        'total': total,
        'resolved': resolved,
        'active': active,
    })


def _staff_ok(user):
    return user.is_authenticated and user.is_staff


def admin_stats(request):
    if not _staff_ok(request.user):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    return JsonResponse({
        'users': User.objects.filter(is_staff=False).count(),
        'issues': Issue.objects.count(),
        'pending': Issue.objects.filter(status='pending').count(),
        'in_progress': Issue.objects.filter(status='in_progress').count(),
        'resolved': Issue.objects.filter(status='resolved').count(),
    })


def admin_issues(request):
    if not _staff_ok(request.user):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    qs = Issue.objects.select_related('user').all()
    data = []
    for issue in qs:
        d = _issue_dict(issue, request)
        d['user'] = issue.user.username if issue.user_id else '—'
        data.append(d)
    if data:
        sorted_idx = sorted(range(len(data)), key=lambda k: data[k].get('impact_score', 0), reverse=True)
        top_n = max(1, len(data) // 10)
        top_set = set(sorted_idx[:top_n])
        for idx, d in enumerate(data):
            d['is_trending'] = idx in top_set
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
        st = data.get('status')
        if st in ('pending', 'in_progress', 'resolved'):
            issue.status = st
            issue.save(update_fields=['status'])
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
