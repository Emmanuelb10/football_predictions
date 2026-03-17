#!/bin/bash
# Setup PostgreSQL for Football Predictions App
set -e

echo "=== Starting PostgreSQL setup ==="

# Start PostgreSQL service
sudo pg_ctlcluster 17 main start 2>/dev/null || sudo service postgresql start 2>/dev/null || true

# Wait for PostgreSQL to be ready
sleep 2

# Create user and database
sudo -u postgres psql -c "CREATE USER football_app WITH PASSWORD 'football_pass';" 2>/dev/null || echo "User may already exist"
sudo -u postgres psql -c "CREATE DATABASE football_predictions OWNER football_app;" 2>/dev/null || echo "Database may already exist"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE football_predictions TO football_app;"

echo "=== PostgreSQL setup complete ==="
echo "Connection: postgresql://football_app:football_pass@localhost:5432/football_predictions"
