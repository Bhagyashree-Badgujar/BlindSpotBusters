# CivicLens — Smart Civic Issue Reporting System

## Run locally (SQLite)

```bash
python manage.py migrate
python manage.py runserver
```

## Cross-device database consistency (shared DB)

If you want **the same users/issues across devices**, you must point every clone to the **same database server** (SQLite is per-machine file).

Set an environment variable before running:

- **PostgreSQL**

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME"
python manage.py migrate
python manage.py runserver
```

- **Email**

By default, email uses the **console backend** in development (emails print to the terminal).
To send real emails, set:

```powershell
$env:EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend"
$env:EMAIL_HOST="smtp.gmail.com"
$env:EMAIL_PORT="587"
$env:EMAIL_USE_TLS="true"
$env:EMAIL_HOST_USER="YOUR_EMAIL"
$env:EMAIL_HOST_PASSWORD="YOUR_APP_PASSWORD"
$env:DEFAULT_FROM_EMAIL="CivicLens <YOUR_EMAIL>"
python manage.py runserver
```

Team Members:
1. Bhagyashree Badgujar
2. Radhika Sankpal
3. Sayali Talekar
4. Vinod Mangate

