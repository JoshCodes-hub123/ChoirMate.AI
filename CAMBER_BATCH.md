# Camber batch workflow

The React frontend, Express API, and Python FastAPI service remain unchanged. Camber is an optional batch worker, not a public API host.

## Where to run the helper

Run `choirmate_camber.py` only inside the authenticated Camber notebook/control environment where the Camber SDK and private Stash are available. Never expose Camber credentials in browser code, Vercel variables, or public Express routes.

## Safe first-run defaults

- One `XXSMALL` CPU node.
- No explicit `mount_dir`; use the confirmed Stash-mirrored working directory.
- SmolLM2 is disabled and auto-download is disabled for the initial run.
- WAV is the default audio format, avoiding an unverified FFmpeg dependency.
- Retrieval requires `--confirm-complete` and a successful Camber job status.

## Run

```bash
python choirmate_camber.py submit --input ./your-score.pdf
```

Save the printed job ID and run ID.

Check progress:

```bash
python choirmate_camber.py status --job-id YOUR_JOB_ID
```

After Camber confirms success:

```bash
python choirmate_camber.py retrieve --job-id YOUR_JOB_ID --run-id YOUR_RUN_ID --destination ./choirmate-results --confirm-complete
```

Expected output files include `analysis.json`, a WAV/MP3 audio file, `audio-metadata.json`, and `manifest.json`.

## Integration boundary

This helper provides a manual control-plane workflow. It does not make the public Express API submit Camber jobs automatically. Automatic submission requires a separate trusted orchestrator with private credentials and durable job/result storage. Do not put Camber credentials in the frontend or public API.

The job installs Python requirements using the documented CPU wheel index for llama-cpp-python. SmolLM2 remains disabled for the first run so no model is downloaded unexpectedly. No job is created unless the submit command is explicitly run.
