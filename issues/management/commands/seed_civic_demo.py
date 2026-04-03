"""
Seed large demo datasets: 500+ demo users across Indian cities with realistic issues.
Run: python manage.py seed_civic_demo --users=520
"""

import random
import re
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from issues.models import Issue
from users.models import UserProfile


INDIA_HUBS = [
    (28.6139, 77.2090, 'Delhi'),
    (19.0760, 72.8777, 'Mumbai'),
    (12.9716, 77.5946, 'Bengaluru'),
    (13.0827, 80.2707, 'Chennai'),
    (22.5726, 88.3639, 'Kolkata'),
    (17.3850, 78.4867, 'Hyderabad'),
    (23.0225, 72.5714, 'Ahmedabad'),
    (26.9124, 75.7873, 'Jaipur'),
    (21.1458, 79.0882, 'Nagpur'),
    (15.2993, 74.1240, 'Goa'),
    (32.7266, 74.8570, 'Jammu'),
    (11.0168, 76.9558, 'Coimbatore'),
]

CATEGORIES = ['water', 'potholes', 'garbage', 'streetlight', 'others']
CAT_WEIGHTS = [0.22, 0.24, 0.22, 0.14, 0.18]


def _next_demo_index():
    max_n = 0
    for name in User.objects.filter(username__startswith='demo_citizen_').values_list('username', flat=True):
        m = re.match(r'^demo_citizen_(\d+)$', name)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return max_n + 1


class Command(BaseCommand):
    help = 'Create demo users (default 520) with geo-distributed issues for dashboards and maps.'

    def add_arguments(self, parser):
        parser.add_argument('--users', type=int, default=520)

    @transaction.atomic
    def handle(self, *args, **options):
        target = max(0, int(options['users']))
        demo_count = User.objects.filter(username__startswith='demo_citizen_').count()
        to_create = max(0, target - demo_count)
        if to_create == 0:
            self.stdout.write(self.style.WARNING('Already at or above target demo users; nothing to do.'))
            return

        next_idx = _next_demo_index()
        created_users = 0
        created_issues = 0

        for k in range(to_create):
            idx = next_idx + k
            username = f'demo_citizen_{idx}'
            if User.objects.filter(username=username).exists():
                continue
            u = User.objects.create_user(
                username=username,
                email=f'{username}@demo.civiclens.local',
                password='DemoPass123!',
            )
            UserProfile.objects.create(user=u, civic_points=random.randint(5, 420))
            created_users += 1

            n_issues = random.choices([1, 2, 3, 4], weights=[0.35, 0.35, 0.22, 0.08])[0]
            for j in range(n_issues):
                lat0, lng0, city = random.choice(INDIA_HUBS)
                lat = lat0 + random.uniform(-0.06, 0.06)
                lng = lng0 + random.uniform(-0.06, 0.06)
                cat = random.choices(CATEGORIES, weights=CAT_WEIGHTS, k=1)[0]
                status = random.choices(
                    ['resolved', 'pending', 'in_progress'],
                    weights=[0.72, 0.16, 0.12],
                    k=1,
                )[0]
                vstate = 'unverified'
                if status == 'resolved':
                    vstate = random.choices(
                        ['unverified', 'verified', 'disputed'],
                        weights=[0.52, 0.38, 0.10],
                        k=1,
                    )[0]
                v_confirm = random.randint(0, 4) if vstate == 'verified' else random.randint(0, 2)
                v_dispute = random.randint(0, 2) if vstate == 'disputed' else random.randint(0, 1)

                title = f'{cat.replace("_", " ").title()} near {city} #{idx}-{j}'
                Issue.objects.create(
                    user=u,
                    title=title[:255],
                    description=(
                        f'Seeded civic report for dashboards. Category={cat}, hub={city}. '
                        f'Coordinates jittered for realistic dispersion.'
                    ),
                    status=status,
                    category=cat,
                    priority=random.choice(['high', 'medium', 'low']),
                    lat=lat,
                    lng=lng,
                    votes=random.randint(0, 18),
                    verification_state=vstate,
                    verified_confirm_count=v_confirm,
                    verified_dispute_count=v_dispute,
                    created_at=timezone.now() - timedelta(days=random.randint(0, 120)),
                )
                created_issues += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'Seed complete: new demo users={created_users}, new issues={created_issues}.'
            )
        )
