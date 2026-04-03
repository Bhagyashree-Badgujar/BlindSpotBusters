"""
URL configuration for backend project.
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path

from issues import views as issue_views
from users import views as user_views

admin.site.site_header = 'CivicLens Administration'
admin.site.site_title = 'CivicLens Admin'
admin.site.index_title = 'CivicLens Government Console'

urlpatterns = [
    path('admin/', admin.site.urls),

    path('', user_views.home, name='home'),
    path('about/', user_views.about_page, name='about'),
    path('contact/', user_views.contact_page, name='contact'),
    path('track/', user_views.track_issue_page, name='track_issue'),

    path('login/', user_views.login_page, name='login_page'),
    path('register/', user_views.register_page, name='register_page'),
    path('dashboard/', user_views.dashboard_page, name='dashboard'),
    path('my-reports/', user_views.my_reports_page, name='my_reports'),
    path('submit-issue/', user_views.submit_issue_page, name='submit_issue'),
    path('admin-login/', user_views.admin_login_page, name='admin_login_page'),
    path('admin-dashboard/', user_views.admin_dashboard_page, name='admin_dashboard'),
    path('map-view/', user_views.map_view_page, name='map_view'),
    path('certificates/<int:id>/', user_views.certificate_view, name='certificate_view'),
    path('reports/<int:id>/pdf/', issue_views.issue_report_pdf, name='issue_report_pdf'),

    path('api/login/', user_views.login_user),
    path('api/logout/', user_views.logout_user),
    path('api/register/', user_views.register_user),
    path('api/user/notifications/', user_views.user_notifications_api),
    path('api/user/notifications/read/', user_views.user_notifications_read_api),

    path('api/user/stats/', issue_views.user_stats),
    path('api/public/stats/', issue_views.public_stats),
    path('api/public/news/', issue_views.public_news),
    path('api/issues/meta/', issue_views.issues_meta),
    path('api/issues/nearby/', issue_views.issues_nearby),
    path('api/issues/suggest-category/', issue_views.suggest_category),
    path('api/issues/<int:id>/verify/', issue_views.verify_issue),

    path('api/issues/', issue_views.user_issues),
    path('api/issues/<int:id>/', issue_views.issue_detail),
    path('api/issues/<int:id>/vote/', issue_views.issue_vote),
    path('api/issues/check-duplicate/', issue_views.check_duplicate),

    path('report/', issue_views.create_issue),

    path('api/admin-login/', user_views.admin_login),
    path('api/admin/users/', user_views.admin_users),
    path('api/admin/stats/', issue_views.admin_stats),
    path('api/admin/issues/', issue_views.admin_issues),
    path('api/admin/issues/<int:id>/', issue_views.admin_issue_update),
    path('api/admin/issues/<int:id>/after-image/', issue_views.admin_issue_after_image),
]

urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
