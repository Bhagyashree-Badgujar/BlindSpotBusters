# CivicLens — crowd verification fields + model

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("issues", "0004_alter_issue_options_alter_issue_user"),
    ]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="verified_confirm_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="issue",
            name="verified_dispute_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="issue",
            name="verification_points_awarded",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="issue",
            name="verification_state",
            field=models.CharField(
                choices=[
                    ("unverified", "Unverified"),
                    ("verified", "Verified"),
                    ("disputed", "Disputed"),
                ],
                default="unverified",
                max_length=16,
            ),
        ),
        migrations.CreateModel(
            name="IssueVerification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("choice", models.CharField(choices=[("confirm", "Confirm resolved"), ("dispute", "Still not fixed")], max_length=12)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "issue",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="verifications", to="issues.issue"),
                ),
                (
                    "user",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="issue_verifications", to=settings.AUTH_USER_MODEL),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name="issueverification",
            constraint=models.UniqueConstraint(fields=("user", "issue"), name="issues_issueverification_user_issue_uniq"),
        ),
    ]

