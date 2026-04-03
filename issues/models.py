# issues/models.py

from django.contrib.auth.models import User
from django.db import models


class Issue(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('in_progress', 'In Progress'),
        ('resolved', 'Resolved'),
    ]

    CATEGORY_CHOICES = [
        ('potholes', 'Potholes'),
        ('garbage', 'Garbage'),
        ('streetlight', 'Streetlight Broken'),
        ('water', 'Water Issue'),
        ('others', 'Others'),
    ]

    PRIORITY_CHOICES = [
        ('high', 'High'),
        ('medium', 'Medium'),
        ('low', 'Low'),
    ]

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='issues', null=True, blank=True
    )
    title = models.CharField(max_length=255)
    description = models.TextField()

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    votes = models.IntegerField(default=0)

    category = models.CharField(max_length=32, choices=CATEGORY_CHOICES, default='others')
    priority = models.CharField(max_length=16, choices=PRIORITY_CHOICES, default='medium')
    department = models.CharField(max_length=120, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)

    before_img = models.ImageField(upload_to='issues/', blank=True, null=True)
    after_img = models.ImageField(upload_to='issues/', blank=True, null=True)

    lat = models.FloatField(blank=True, null=True)
    lng = models.FloatField(blank=True, null=True)

    # Crowd verification (for resolved status)
    verified_confirm_count = models.PositiveIntegerField(default=0)
    verified_dispute_count = models.PositiveIntegerField(default=0)
    verification_state = models.CharField(
        max_length=16,
        choices=[('unverified', 'Unverified'), ('verified', 'Verified'), ('disputed', 'Disputed')],
        default='unverified',
    )
    verification_points_awarded = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} ({self.status})"

    def recent_nearby_count(self):
        """Issues in roughly ~1.1km box from this point in the last 7 days (excl. self)."""
        if self.lat is None or self.lng is None:
            return 0
        from datetime import timedelta

        from django.utils import timezone

        week_ago = timezone.now() - timedelta(days=7)
        d = 0.01
        return (
            Issue.objects.filter(
                created_at__gte=week_ago,
                lat__gte=self.lat - d,
                lat__lte=self.lat + d,
                lng__gte=self.lng - d,
                lng__lte=self.lng + d,
            )
            .exclude(pk=self.pk)
            .count()
        )

    @property
    def impact_score(self):
        return (self.votes * 2) + (self.recent_nearby_count() * 3)


class IssueVote(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='issue_votes')
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name='votes_cast')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'issue'], name='issues_issuevote_user_issue_uniq'),
        ]


class IssueMedia(models.Model):
    MEDIA_TYPES = [
        ('image', 'Image'),
        ('video', 'Video'),
        ('audio', 'Audio'),
    ]

    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name='extra_media')
    file = models.FileField(upload_to='issues/media/')
    media_type = models.CharField(max_length=16, choices=MEDIA_TYPES, default='image')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.issue_id} ({self.media_type})"


class IssueVerification(models.Model):
    CHOICES = [
        ('confirm', 'Confirm resolved'),
        ('dispute', 'Still not fixed'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='issue_verifications')
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name='verifications')
    choice = models.CharField(max_length=12, choices=CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'issue'],
                name='issues_issueverification_user_issue_uniq',
            ),
        ]
