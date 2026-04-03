# CivicLens — categories, priority, department, votes, media

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('issues', '0002_remove_issue_is_duplicate_remove_issue_updated_at_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='issue',
            name='category',
            field=models.CharField(
                choices=[
                    ('potholes', 'Potholes'),
                    ('garbage', 'Garbage'),
                    ('streetlight', 'Streetlight Broken'),
                    ('water', 'Water Issue'),
                    ('others', 'Others'),
                ],
                default='others',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='issue',
            name='priority',
            field=models.CharField(
                choices=[('high', 'High'), ('medium', 'Medium'), ('low', 'Low')],
                default='medium',
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name='issue',
            name='department',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.CreateModel(
            name='IssueMedia',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('file', models.FileField(upload_to='issues/media/')),
                (
                    'media_type',
                    models.CharField(
                        choices=[('image', 'Image'), ('video', 'Video'), ('audio', 'Audio')],
                        default='image',
                        max_length=16,
                    ),
                ),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                (
                    'issue',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='extra_media',
                        to='issues.issue',
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name='IssueVote',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                (
                    'issue',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='votes_cast',
                        to='issues.issue',
                    ),
                ),
                (
                    'user',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='issue_votes',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name='issuevote',
            constraint=models.UniqueConstraint(fields=('user', 'issue'), name='issues_issuevote_user_issue_uniq'),
        ),
    ]
