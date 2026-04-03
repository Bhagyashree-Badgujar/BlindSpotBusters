import json

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required, user_passes_test
from django.contrib.auth.models import User
from django.db.models import Count
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.csrf import csrf_exempt

from issues.models import Issue
from users.models import Certificate, UserNotification, UserProfile


def home(request):
    stats = {
        'total': Issue.objects.count(),
        'resolved': Issue.objects.filter(status='resolved').count(),
        'active': Issue.objects.exclude(status='resolved').count(),
    }
    return render(request, 'landing.html', {'public_stats': stats})


def about_page(request):
    return render(request, 'about.html')


def contact_page(request):
    return render(request, 'contact.html')


@login_required(login_url='/login/')
def user_notifications_api(request):
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    qs = UserNotification.objects.filter(user=request.user).order_by('-created_at')[:50]
    return JsonResponse(
        [
            {
                'id': n.id,
                'kind': n.kind,
                'title': n.title,
                'body': n.body,
                'read': n.read,
                'issue_id': n.issue_id,
                'created_at': n.created_at.isoformat() if n.created_at else None,
            }
            for n in qs
        ],
        safe=False,
    )


@csrf_exempt
@login_required(login_url='/login/')
def user_notifications_read_api(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    ids = data.get('ids') or []
    if ids:
        UserNotification.objects.filter(user=request.user, id__in=ids).update(read=True)
    return JsonResponse({'ok': True})


def track_issue_page(request):
    return render(request, 'track-issue.html')


def login_page(request):
    if request.user.is_authenticated and not request.user.is_staff:
        return redirect('dashboard')
    return render(request, 'login.html')


def register_page(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    return render(request, 'register.html')


@login_required(login_url='/login/')
def dashboard_page(request):
    if request.user.is_staff:
        return redirect('admin_dashboard')
    return render(request, 'dashboard.html')


@login_required(login_url='/login/')
def my_reports_page(request):
    if request.user.is_staff:
        return redirect('admin_dashboard')
    return render(request, 'my-reports.html')


@login_required(login_url='/login/')
def submit_issue_page(request):
    if request.user.is_staff:
        return redirect('admin_dashboard')
    return render(request, 'submit-issue.html')


def admin_login_page(request):
    if request.user.is_authenticated and request.user.is_staff:
        return redirect('admin_dashboard')
    return render(request, 'admin-login.html')


@user_passes_test(lambda u: u.is_authenticated and u.is_staff, login_url='/admin-login/')
def admin_dashboard_page(request):
    return render(request, 'admin-dashboard.html')


def map_view_page(request):
    if request.user.is_authenticated and request.user.is_staff:
        return redirect('admin_dashboard')
    return render(request, 'map-view.html')


@login_required(login_url='/login/')
def certificate_view(request, id):
    try:
        cert = Certificate.objects.select_related('user').get(pk=id, user=request.user)
    except Certificate.DoesNotExist:
        return redirect('dashboard')
    return render(request, 'certificate.html', {'cert': cert})


@csrf_exempt
def login_user(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Invalid request'}, status=400)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    if not username or not password:
        return JsonResponse({'error': 'Username and password required'}, status=400)

    user = authenticate(request, username=username, password=password)
    if user is None and '@' in username:
        try:
            u = User.objects.get(email__iexact=username)
            user = authenticate(request, username=u.username, password=password)
        except User.DoesNotExist:
            user = None

    if user is not None:
        if user.is_staff:
            return JsonResponse({'error': 'Use admin login for staff accounts'}, status=400)
        login(request, user)
        return JsonResponse({'status': 'success', 'username': user.username})

    return JsonResponse({'error': 'Invalid credentials'}, status=400)


@csrf_exempt
def logout_user(request):
    logout(request)
    return JsonResponse({'status': 'logged out'})


@csrf_exempt
def register_user(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Invalid request'}, status=400)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip()
    password = data.get('password') or ''

    if not username or not email or not password:
        return JsonResponse({'error': 'All fields required'}, status=400)
    if User.objects.filter(username__iexact=username).exists():
        return JsonResponse({'error': 'Username already taken'}, status=400)
    if User.objects.filter(email__iexact=email).exists():
        return JsonResponse({'error': 'Email already exists'}, status=400)

    user = User.objects.create_user(username=username, email=email, password=password)
    UserProfile.objects.get_or_create(user=user)
    login(request, user)
    return JsonResponse({'status': 'registered', 'username': user.username})


@csrf_exempt
def admin_login(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Invalid request'}, status=400)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    password = data.get('password') or ''
    expected = getattr(settings, 'ADMIN_PANEL_PASSWORD', None)
    if not expected:
        return JsonResponse({'error': 'Admin panel not configured'}, status=500)

    if password != expected:
        return JsonResponse({'error': 'Invalid admin password'}, status=400)

    staff = User.objects.filter(is_staff=True).first()
    if staff is None:
        return JsonResponse({'error': 'Create a staff user with manage.py createsuperuser'}, status=500)

    login(request, staff)
    return JsonResponse({'status': 'admin logged in', 'username': staff.username})


def admin_users(request):
    if not request.user.is_authenticated or not request.user.is_staff:
        return JsonResponse({'error': 'Forbidden'}, status=403)

    rows = (
        User.objects.filter(is_staff=False)
        .annotate(issues_submitted=Count('issues'))
        .values('id', 'username', 'email', 'issues_submitted', 'last_login', 'is_active')
    )
    return JsonResponse(list(rows), safe=False)
