from django.contrib import admin

from .models import Issue, IssueMedia, IssueVote


class IssueMediaInline(admin.TabularInline):
    model = IssueMedia
    extra = 0


@admin.register(Issue)
class IssueAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'category', 'priority', 'department', 'user', 'status', 'votes', 'created_at')
    list_filter = ('status', 'category', 'priority')
    search_fields = ('title', 'description', 'department')
    inlines = [IssueMediaInline]


@admin.register(IssueVote)
class IssueVoteAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'issue', 'created_at')


@admin.register(IssueMedia)
class IssueMediaAdmin(admin.ModelAdmin):
    list_display = ('id', 'issue', 'media_type', 'created_at')
