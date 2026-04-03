# issues/models.py

from django.db import models
from django.contrib.auth.models import User


class Issue(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('in_progress', 'In Progress'),
        ('resolved', 'Resolved'),
    ]

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='issues', null=True, blank=True
    )
    title = models.CharField(max_length=255)
    description = models.TextField()

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    votes = models.IntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)

    before_img = models.ImageField(upload_to='issues/', blank=True, null=True)
    after_img = models.ImageField(upload_to='issues/', blank=True, null=True)

    lat = models.FloatField(blank=True, null=True)
    lng = models.FloatField(blank=True, null=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} ({self.status})"

    @property
    def impact_score(self):
        return self.votes * 2
