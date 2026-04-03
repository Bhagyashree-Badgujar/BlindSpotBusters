from django.contrib import admin

from .models import Certificate, UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'civic_points', 'badges')
    search_fields = ('user__username',)


@admin.register(Certificate)
class CertificateAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'cert_type', 'points_at_issue', 'issued_at')
    list_filter = ('cert_type',)
    search_fields = ('user__username', 'user__email')
