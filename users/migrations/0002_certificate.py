# CivicLens — certificates

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Certificate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("cert_type", models.CharField(choices=[("active_citizen", "Active Citizen Award"), ("city_contributor", "City Contributor Certificate")], max_length=32)),
                ("points_at_issue", models.PositiveIntegerField(default=0)),
                ("issued_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="certificates", to=settings.AUTH_USER_MODEL),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name="certificate",
            constraint=models.UniqueConstraint(fields=("user", "cert_type"), name="users_certificate_user_type_uniq"),
        ),
    ]

