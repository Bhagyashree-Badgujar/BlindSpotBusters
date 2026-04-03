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
