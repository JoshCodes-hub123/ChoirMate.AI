# Async HOMR integration — review only

This PR is an integration staging area. **It is NOT ready to merge.**

## Remaining code changes to stage
- `python/service.py` — asynchronous job queue, authentication, compact responses
- `api/[...route].ts` — start/status Vercel gateway routes
- `server.ts` — Express routes
- `src/services/api.ts` — polling, abort handling, restore images
- `src/components/SheetWorkspace.tsx` — progress display

## Release requirements
- [ ] Upload the five files from the previously prepared `ChoirMate-Async-Update-Safe.zip` onto this branch
- [ ] Confirm the PR shows exactly these five app files and this checklist
- [ ] Preserve `.env.windows.local`, `.venv`, Windows BAT launch scripts, and working HOMR requirements
- [ ] Run TypeScript build, Python syntax check and real Windows HOMR tests
- [ ] Test score analysis longer than 55 seconds, image/PDF display and SATB audio
- [ ] Review before merging to `main`; production must remain unchanged until approved

**Status:** Review scaffold only. The five application files have not yet been committed to this branch.
