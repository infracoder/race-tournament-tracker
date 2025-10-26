# Legacy Files

This directory contains historical files that are no longer used in the application but are preserved for reference.

## schedule-seed-legacy.json

**Status:** Deprecated (replaced by dynamic schedule generation)

This was the original fixed schedule for 9-player tournaments. It ensured each of the 9 players (A-I) raced exactly 4 times across 9 races.

The application now uses a **dynamic schedule generator** (`lib/schedule-generator.js`) that creates fair schedules on-the-fly for 8, 9, or 10 players. This provides flexibility while maintaining the same fairness guarantees:
- Each player races exactly 4 times
- 4 players per race
- Minimized repeated pairings
- Balanced distribution

For details on the new scheduling system, see the main README.md.
