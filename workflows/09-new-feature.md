# 9. Adding a New App Feature

Use when I describe a new UI feature I want.

### Decision tree before writing any code
1. **Does this need a new DB column?**
   → Yes → add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to `initDB()` in `storage.ts`
   → Also update the relevant TypeScript interface in `storage.ts` and Drizzle schema in `schema.ts`

2. **Does this need a new API endpoint?**
   → Yes → add to `server/routes.ts`
   → Keep routes thin — all DB logic goes in `storage.ts`

3. **Does this touch the For You feed or recommendations?**
   → Check `getForYouRecommendations()` in `storage.ts`
   → Test with Chaz's real user ID: `u_2znaqxnrq49mp5y5r5g`

4. **Does this change the onboarding flow?**
   → `client/src/components/OnboardingModal.tsx`
   → Style Shuffle is Step 0, aesthetic picker is Step 1, gender is Step 2

### Frontend checklist
- [ ] New page → add to `client/src/pages/` and register route in `App.tsx`
- [ ] New component → add to `client/src/components/`
- [ ] Hash routing: use `<Link href="/new-page">` not `<a href="...">`
- [ ] No `localStorage` for server data — use `useQuery`/`apiRequest`
- [ ] Add `data-testid` attributes to interactive elements
- [ ] Test dark mode — everything must work with and without `.dark` class
- [ ] Pull-to-refresh: if the page has a feed, add `onRefresh` support

### Build and verify
```powershell
npm run build   # must pass with 0 TypeScript errors
npm run dev     # test locally at localhost:5000
```
