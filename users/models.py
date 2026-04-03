from django.contrib.auth.models import User
from django.db import models


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    civic_points = models.PositiveIntegerField(default=0)
    badges = models.JSONField(default=list, blank=True)

    def __str__(self):
        return f"{self.user.username} ({self.civic_points} pts)"


class Certificate(models.Model):
    CERT_CHOICES = [
        ('civic_spark', 'Civic Spark Recognition (50+ Points)'),
        ('active_citizen', 'Active Citizen Award'),
        ('city_contributor', 'City Contributor Certificate'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='certificates')
    cert_type = models.CharField(max_length=32, choices=CERT_CHOICES)
    points_at_issue = models.PositiveIntegerField(default=0)
    issued_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'cert_type'], name='users_certificate_user_type_uniq'),
        ]

    def __str__(self):
        return f"{self.user.username} — {self.cert_type}"


class UserNotification(models.Model):
    KIND_CHOICES = [
        ('resolved', 'Issue resolved'),
        ('points', 'Points milestone'),
        ('verified', 'Issue verified'),
        ('system', 'System'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='civic_notifications')
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default='system')
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    read = models.BooleanField(default=False)
    issue_id = models.PositiveIntegerField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.username}: {self.title[:40]}"
