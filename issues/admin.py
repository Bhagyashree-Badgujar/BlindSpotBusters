from django.contrib import admin

from .models import Issue


@admin.register(Issue)
class IssueAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'user', 'status', 'votes', 'created_at')
    list_filter = ('status',)
    search_fields = ('title', 'description')
