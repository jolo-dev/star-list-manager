# Add Archive Cards and Infinite Scroll

## Why
The approved reference includes List/Cards navigation, while the dashboard currently renders only a capped dense list.

## What
Add a real accessible List/Cards local view toggle and sentinel-driven progressive rendering of the existing local filtered result set. Reset the visible batch when query/view data changes and provide an accessible fallback when observers are unavailable.

## Non-goals
No remote pagination, new dependencies, fake results, storage, API, authentication, or mutation changes.
