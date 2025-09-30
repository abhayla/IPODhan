# IPODhan Database Migrations

## Running Migrations

### Local Development

```bash
# Connect to local PostgreSQL
psql -U postgres -d ipodhan -f migrations/001_initial_schema.sql
```

### Using Docker

```bash
# Execute migration inside Docker container
docker exec -i postgres_container psql -U postgres -d ipodhan < migrations/001_initial_schema.sql
```

## Migration Files

- `001_initial_schema.sql` - Initial database schema with all core tables and indexes

## Database Structure

### Tables
- `ipos` - Core IPO information
- `ipo_scores` - IPO scoring and verdicts
- `gmp_history` - Grey Market Premium tracking
- `subscription_data` - IPO subscription statistics
- `users` - User accounts and preferences
- `user_watchlist` - User IPO watchlists
- `api_keys` - B2B partner API keys

### Indexes
Performance indexes are created on frequently queried columns for optimal query performance.