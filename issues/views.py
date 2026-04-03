import json

from django.contrib.auth.models import User
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .models import Issue


def api_login_required(view):
    def wrap(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required'}, status=401)
        return view(request, *args, **kwargs)

    return wrap


def _issue_dict(issue, request):
    before = issue.before_img.url if issue.before_img else ''
    after = issue.after_img.url if issue.after_img else ''
    if before and request and not before.startswith('http'):
        before = request.build_absolute_uri(before)
    if after and request and not after.startswith('http'):
        after = request.build_absolute_uri(after)
    return {
        'id': issue.id,
        'title': issue.title,
        'description': issue.description,
        'status': issue.status,
        'votes': issue.votes,
        'recent_reports': 0,
        'is_duplicate': False,
        'created_at': issue.created_at.isoformat() if issue.created_at else None,
        'updated_at': issue.created_at.isoformat() if issue.created_at else None,
        'lat': issue.lat,
        'lng': issue.lng,
        'before_img': before,
        'after_img': after,
        'user': issue.user.username if issue.user_id else '',
        'user_id': issue.user_id,
        'user_voted': False,
    }


def user_issues(request):
    qs = Issue.objects.select_related('user').all()
    if request.GET.get('mine') == 'true':
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required'}, status=401)
        qs = qs.filter(user=request.user)
    data = [_issue_dict(i, request) for i in qs]
    return JsonResponse(data, safe=False)


def issue_detail(request, id):
    try:
        issue = Issue.objects.select_related('user').get(id=id)
        return JsonResponse(_issue_dict(issue, request))
    except Issue.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)


@csrf_exempt
def issue_vote(request, id):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    try:
        issue = Issue.objects.get(id=id)
        issue.votes += 1
        issue.save(update_fields=['votes'])
        return JsonResponse({'votes': issue.votes, 'user_voted': True})
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


def _staff_ok(user):
    return user.is_authenticated and user.is_staff


def admin_stats(request):
    if not _staff_ok(request.user):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    return JsonResponse({
        'users': User.objects.filter(is_staff=False).count(),
        'issues': Issue.objects.count(),
        'pending': Issue.objects.filter(status='pending').count(),
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
