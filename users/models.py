from django.contrib.auth.models import User
from django.db import models


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    civic_points = models.PositiveIntegerField(default=0)
    badges = models.JSONField(default=list, blank=True)

    def __str__(self):
        return f"{self.user.username} ({self.civic_points} pts)"
