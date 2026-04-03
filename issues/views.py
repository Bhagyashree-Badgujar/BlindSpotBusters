import json

from django.conf import settings
from django.contrib.auth.models import User
from django.db.models import Count, F, Max, Sum
from django.http import JsonResponse
from django.core.mail import send_mail
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from users.models import Certificate, UserProfile, UserNotification

from .models import Issue, IssueMedia, IssueVerification, IssueVote

# Domain priority for admin sorting: Water > Potholes > Garbage > Streetlight > Others
CAT_DOMAIN_ORDER = {'water': 5, 'potholes': 4, 'garbage': 3, 'streetlight': 2, 'others': 1}


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


def _exif_from_upload(file_obj):
    """
    Returns (captured_at_aware, suspicious: bool, note: str).
    Flags photos whose EXIF capture date is older than ~18 months as suspicious.
    """
    if not file_obj:
        return None, False, ''
    try:
        from PIL import Image
        from PIL.ExifTags import TAGS

        file_obj.seek(0)
        img = Image.open(file_obj)
        exif = img.getexif() or {}
        raw_dt = None
        for tag_id, val in exif.items():
            tag = TAGS.get(tag_id, tag_id)
            if tag in ('DateTimeOriginal', 'DateTime'):
                raw_dt = val
                break
        file_obj.seek(0)
        if not raw_dt or not isinstance(raw_dt, str):
            return None, False, 'No EXIF date'
        from datetime import datetime

        from django.utils import timezone

        naive = datetime.strptime(raw_dt.replace('-', ':')[:19], '%Y:%m:%d %H:%M:%S')
        aware = timezone.make_aware(naive, timezone.get_current_timezone())
        age_days = (timezone.now() - aware).days
        suspicious = age_days > 550
        note = f'EXIF capture {aware.date().isoformat()}'
        if suspicious:
            note += ' — old photo (verify authenticity)'
        return aware, suspicious, note
    except Exception:
        try:
            file_obj.seek(0)
        except Exception:
            pass
        return None, False, 'EXIF unavailable'


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

    user_verification = ''
    if request.user.is_authenticated:
        uv = (
            IssueVerification.objects.filter(user=request.user, issue=issue)
            .values_list('choice', flat=True)
            .first()
        )
        user_verification = uv or ''

    v_confirm = int(issue.verified_confirm_count or 0)
    v_dispute = int(issue.verified_dispute_count or 0)
    v_state = issue.verification_state or 'unverified'

    v_label = 'Unverified'
    if v_state == 'verified':
        v_label = f'Verified by {v_confirm} users'
    elif v_state == 'disputed':
        v_label = 'Disputed ⚠️'
    elif v_confirm or v_dispute:
        v_label = f'Crowd votes: {v_confirm} confirm / {v_dispute} dispute'

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
        'user_verification': user_verification,
        'verified_confirm_count': v_confirm,
        'verified_dispute_count': v_dispute,
        'verification_state': v_state,
        'verification_label': v_label,
        'is_duplicate': False,
        'photo_exif_at': issue.before_img_captured_at.isoformat() if issue.before_img_captured_at else None,
        'image_exif_suspicious': bool(issue.image_exif_suspicious),
        'image_exif_note': (issue.image_exif_note or '')[:200],
    }


def _notify_in_app(user, kind, title, body, issue_id=None):
    if user is None:
        return
    UserNotification.objects.create(user=user, kind=kind, title=title, body=body, issue_id=issue_id)


def _notify_issue_resolved_emails(issue):
    """Email reporter + everyone who upvoted the issue."""
    subject = f'CivicLens resolved: {issue.title[:60]}'
    body = (
        f'Issue #{issue.id}: {issue.title}\n\n'
        f'Status: RESOLVED by the department.\n'
        f'Thank you for participating in CivicLens.\n'
    )
    emails = set()
    if issue.user_id and issue.user.email:
        emails.add(issue.user.email.strip())
    for row in IssueVote.objects.filter(issue=issue).select_related('user'):
        if row.user.email:
            emails.add(row.user.email.strip())
    for em in emails:
        _safe_send_mail(subject, body, em)
    if issue.user_id:
        _notify_in_app(
            issue.user,
            'resolved',
            f'Resolved: {issue.title[:80]}',
            'Your issue was marked resolved. Open CivicLens to verify or view details.',
            issue_id=issue.id,
        )
    for row in IssueVote.objects.filter(issue=issue).select_related('user'):
        if row.user_id != issue.user_id:
            _notify_in_app(
                row.user,
                'resolved',
                f'Issue you supported was resolved: {issue.title[:60]}',
                f'Issue #{issue.id} is now resolved.',
                issue_id=issue.id,
            )


def _safe_send_mail(subject, message, to_email):
    if not to_email:
        return
    try:
        send_mail(
            subject,
            message,
            getattr(settings, 'DEFAULT_FROM_EMAIL', None) or 'no-reply@civiclens.local',
            [to_email],
            fail_silently=True,
        )
    except Exception:
        return


def _recompute_verification(issue):
    counts = (
        IssueVerification.objects.filter(issue=issue)
        .values('choice')
        .annotate(c=Count('id'))
    )
    confirm = 0
    dispute = 0
    for row in counts:
        if row['choice'] == 'confirm':
            confirm = row['c']
        elif row['choice'] == 'dispute':
            dispute = row['c']

    state = 'unverified'
    # Simple majority rules
    if confirm >= 3 and confirm > dispute:
        state = 'verified'
    elif (dispute >= 2 and dispute >= confirm) or (confirm and dispute and confirm == dispute):
        state = 'disputed'

    Issue.objects.filter(pk=issue.pk).update(
        verified_confirm_count=confirm,
        verified_dispute_count=dispute,
        verification_state=state,
    )
    issue.refresh_from_db(
        fields=['verified_confirm_count', 'verified_dispute_count', 'verification_state', 'verification_points_awarded']
    )
    return state, confirm, dispute


def _maybe_award_verification_points_and_certificate(issue):
    """
    Awards points + certificates to the REPORTER when a resolved issue becomes crowd-verified.
    """
    if issue.status != 'resolved':
        return
    if not issue.user_id:
        return
    if issue.verification_state != 'verified':
        return
    if issue.verification_points_awarded:
        return

    profile, _ = UserProfile.objects.get_or_create(user=issue.user)
    profile.civic_points += 60
    badges = list(profile.badges or [])
    if 'verified_resolution' not in badges:
        badges.append('verified_resolution')
    profile.badges = badges
    profile.save(update_fields=['civic_points', 'badges'])

    Issue.objects.filter(pk=issue.pk).update(verification_points_awarded=True)
    issue.refresh_from_db(fields=['verification_points_awarded'])

    issued = []
    # Milestones
    if profile.civic_points >= 100:
        cert, created = Certificate.objects.get_or_create(
            user=issue.user,
            cert_type='active_citizen',
            defaults={'points_at_issue': profile.civic_points},
        )
        if created:
            issued.append(cert)
    if profile.civic_points >= 250:
        cert, created = Certificate.objects.get_or_create(
            user=issue.user,
            cert_type='city_contributor',
            defaults={'points_at_issue': profile.civic_points},
        )
        if created:
            issued.append(cert)

    if issued and issue.user.email:
        names = ', '.join(dict(Certificate.CERT_CHOICES).get(c.cert_type, c.cert_type) for c in issued)
        _safe_send_mail(
            'CivicLens: Certificate issued',
            f'Congratulations {issue.user.username}.\n\nYou have been issued: {names}.\n\nLogin to CivicLens to view and download your certificate.',
            issue.user.email,
        )



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

    if before_img:
        cap, sus, note = _exif_from_upload(before_img)
        Issue.objects.filter(pk=issue.pk).update(
            before_img_captured_at=cap,
            image_exif_suspicious=sus,
            image_exif_note=(note or '')[:200],
        )

    for f in evidence_files:
        if not f:
            continue
        mt = _guess_media_type(f.name, getattr(f, 'content_type', '') or '')
        IssueMedia.objects.create(issue=issue, file=f, media_type=mt)

    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    prev_points = profile.civic_points
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

    if profile.civic_points >= 50 and prev_points < 50:
        cert, created = Certificate.objects.get_or_create(
            user=request.user,
            cert_type='civic_spark',
            defaults={'points_at_issue': profile.civic_points},
        )
        if created:
            _notify_in_app(
                request.user,
                'points',
                'You unlocked a Civic Spark certificate (50+ points)',
                'Download your certificate from the dashboard.',
                issue_id=issue.id,
            )
            if request.user.email:
                _safe_send_mail(
                    'CivicLens: Civic Spark certificate unlocked',
                    f'Congratulations {request.user.username}.\n\n'
                    f'You reached {profile.civic_points} civic points. Open your dashboard to view and download your certificate.\n',
                    request.user.email,
                )

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
            'certificates': list(
                Certificate.objects.filter(user=user)
                .order_by('issued_at')
                .values('id', 'cert_type', 'points_at_issue', 'issued_at')
            ),
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
            'verified': Issue.objects.filter(verification_state='verified').count(),
            'disputed': Issue.objects.filter(verification_state='disputed').count(),
        }
    )

@csrf_exempt
@api_login_required
@require_http_methods(['POST'])
def verify_issue(request, id):
    """
    Crowd verification for resolved issues:
      - confirm: 👍 Confirm resolved
      - dispute: ❌ Still not fixed
    """
    try:
        issue = Issue.objects.select_related('user').get(pk=id)
    except Issue.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)

    prev_verification = issue.verification_state

    if issue.status != 'resolved':
        return JsonResponse({'error': 'Verification is available only for resolved issues'}, status=400)

    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    choice = (data.get('choice') or '').strip()
    if choice not in ('confirm', 'dispute'):
        return JsonResponse({'error': 'Invalid choice'}, status=400)

    # One vote per user; allow change
    obj, created = IssueVerification.objects.get_or_create(
        user=request.user,
        issue=issue,
        defaults={'choice': choice},
    )
    if not created and obj.choice != choice:
        obj.choice = choice
        obj.save(update_fields=['choice'])

    state, confirm, dispute = _recompute_verification(issue)
    _maybe_award_verification_points_and_certificate(issue)

    if state == 'verified' and prev_verification != 'verified' and issue.user_id:
        _notify_in_app(
            issue.user,
            'verified',
            f'Crowd verified: {issue.title[:70]}',
            'Citizens confirmed your resolved issue. Thank you for improving the city.',
            issue_id=issue.id,
        )
        if issue.user.email:
            _safe_send_mail(
                'CivicLens: Issue crowd-verified',
                f'Hello {issue.user.username},\n\nYour resolved issue "{issue.title}" has been crowd-verified on CivicLens.\n',
                issue.user.email,
            )

    label = 'Unverified'
    if state == 'verified':
        label = f'Verified by {confirm} users'
    elif state == 'disputed':
        label = 'Disputed ⚠️'
    elif confirm or dispute:
        label = f'Crowd votes: {confirm} confirm / {dispute} dispute'

    return JsonResponse(
        {
            'status': 'ok',
            'verification_state': state,
            'verified_confirm_count': confirm,
            'verified_dispute_count': dispute,
            'verification_label': label,
            'user_verification': choice,
        }
    )


def _staff_ok(user):
    return user.is_authenticated and user.is_staff


def admin_stats(request):
    if not _staff_ok(request.user):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    by_category = list(Issue.objects.values('category').annotate(count=Count('id')).order_by('-count'))
    by_priority = list(Issue.objects.values('priority').annotate(count=Count('id')).order_by('-count'))
    by_status = list(Issue.objects.values('status').annotate(count=Count('id')))
    by_verification = list(
        Issue.objects.values('verification_state').annotate(count=Count('id')).order_by('-count')
    )
    points = UserProfile.objects.filter(user__is_staff=False).aggregate(
        max_points=Max('civic_points'),
        total_points=Sum('civic_points'),
    )
    # Mutually exclusive donut segments (verified/disputed apply to resolved pipeline)
    donut_issue_mix = {
        'pending': Issue.objects.filter(status='pending').count(),
        'in_progress': Issue.objects.filter(status='in_progress').count(),
        'resolved_unverified': Issue.objects.filter(
            status='resolved', verification_state='unverified'
        ).count(),
        'verified': Issue.objects.filter(verification_state='verified').count(),
        'disputed': Issue.objects.filter(verification_state='disputed').count(),
    }
    return JsonResponse(
        {
            'users': User.objects.filter(is_staff=False).count(),
            'issues': Issue.objects.count(),
            'pending': Issue.objects.filter(status='pending').count(),
            'resolved': Issue.objects.filter(status='resolved').count(),
            'in_progress': Issue.objects.filter(status='in_progress').count(),
            'verified': Issue.objects.filter(verification_state='verified').count(),
            'disputed': Issue.objects.filter(verification_state='disputed').count(),
            'by_category': by_category,
            'by_priority': by_priority,
            'by_status': by_status,
            'by_verification': by_verification,
            'donut_issue_mix': donut_issue_mix,
            'max_points': points.get('max_points') or 0,
            'total_points': points.get('total_points') or 0,
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

    def _admin_sort_key(d):
        cat = (d.get('category') or 'others').lower()
        rank = CAT_DOMAIN_ORDER.get(cat, 0)
        return (-rank, -float(d.get('impact_score') or 0), -int(d['id']))

    data.sort(key=_admin_sort_key)
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
        prev_status = issue.status
        fields = []
        st = data.get('status')
        if st in ('pending', 'in_progress', 'resolved'):
            if issue.status == 'resolved' and st != 'resolved':
                return JsonResponse(
                    {'error': 'Resolved issues cannot be re-opened'}, status=400
                )
            issue.status = st
            fields.append('status')
        if 'department' in data and isinstance(data.get('department'), str):
            issue.department = (data.get('department') or '')[:120]
            fields.append('department')
        pr = data.get('priority')
        if pr in ('high', 'medium', 'low') and issue.status != 'resolved':
            issue.priority = pr
            fields.append('priority')
        if fields:
            issue.save(update_fields=fields)
        if prev_status != issue.status and issue.status == 'resolved':
            issue.refresh_from_db()
            _notify_issue_resolved_emails(issue)
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


def public_news(request):
    """Location-aware government-style updates for landing page."""
    region = (request.GET.get('region') or '').strip() or 'India'
    items = [
        {
            'title': 'Municipal SLA alignment — civic backlog review',
            'summary': 'Departments prioritise water and road safety tickets synced through CivicLens analytics.',
            'region': region,
            'tag': 'Governance',
        },
        {
            'title': 'Field verification teams expanded',
            'summary': 'Photo evidence review and EXIF checks strengthen authenticity on high-impact reports.',
            'region': 'National',
            'tag': 'Operations',
        },
        {
            'title': 'Citizen verification pilot — week ahead',
            'summary': 'Crowd confirmations now feed verified badges and certificates for active residents.',
            'region': region,
            'tag': 'Community',
        },
    ]
    return JsonResponse(items, safe=False)
