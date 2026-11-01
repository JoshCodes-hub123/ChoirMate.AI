"""
Camber control-plane helper for ChoirMate.AI.

Run this script inside the Camber notebook/control environment where the
Camber SDK and private Stash are already authenticated. It is NOT part of
the public Express API and must never be exposed to the browser.

Examples:
  python choirmate_camber.py submit --input ./score.pdf
  python choirmate_camber.py status --job-id JOB_ID
  python choirmate_camber.py retrieve --job-id JOB_ID --run-id RUN_ID --confirm-complete

No job is submitted unless the submit subcommand is explicitly run.
"""

from __future__ import annotations

import argparse
import shlex
import uuid
from pathlib import Path


REPOSITORY_URL = "https://github.com/JoshCodes-hub123/ChoirMate.AI.git"
CPU_WHEEL_INDEX = "https://abetlen.github.io/llama-cpp-python/whl/cpu"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Submit and retrieve ChoirMate.AI Camber jobs.")
    commands = parser.add_subparsers(dest="action", required=True)

    submit = commands.add_parser("submit", help="Upload one score to private Stash and submit one CPU job.")
    submit.add_argument("--input", required=True, help="Local path to PDF, image, XML, or MusicXML.")
    submit.add_argument("--title", default=None)
    submit.add_argument("--composer", default="Unknown Composer")
    submit.add_argument("--tempo", type=int, default=76)
    submit.add_argument("--audio-format", choices=("wav", "mp3"), default="wav")
    submit.add_argument("--voice", choices=("choir", "piano", "strings"), default="choir")
    submit.add_argument("--metronome", action="store_true")
    submit.add_argument("--run-id", default=None, help="Optional caller-provided unique ID.")

    status = commands.add_parser("status", help="Read the status and recent logs for a Camber job.")
    status.add_argument("--job-id", required=True)

    retrieve = commands.add_parser("retrieve", help="Copy completed job outputs from private Stash.")
    retrieve.add_argument("--job-id", required=True)
    retrieve.add_argument("--run-id", required=True)
    retrieve.add_argument("--destination", default="./choirmate-results")
    retrieve.add_argument(
        "--confirm-complete",
        action="store_true",
        help="Required confirmation that the Camber dashboard reports the job completed.",
    )
    return parser


def submit(args: argparse.Namespace) -> None:
    import camber
    import camber.stash

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    supported = {".pdf", ".xml", ".musicxml", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"}
    if input_path.suffix.lower() not in supported:
        raise ValueError(f"Unsupported input extension: {input_path.suffix}")

    run_id = args.run_id or uuid.uuid4().hex
    if not run_id.replace("-", "").replace("_", "").isalnum():
        raise ValueError("run-id may contain only letters, numbers, hyphens, and underscores.")

    input_dir = f"choirmate/jobs/{run_id}/input"
    output_dir = f"choirmate/jobs/{run_id}/output"
    input_name = input_path.name

    stash = camber.stash.private
    stash.mkdir(input_dir)
    stash.cp(src_path=str(input_path), dest_path=f"{input_dir}/{input_name}")

    # Paths are relative to the Stash-mirrored working directory. The job
    # starts in that directory by default, then clones the public repo into ./repo.
    command_parts = [
        f"git clone --branch main --depth 1 {shlex.quote(REPOSITORY_URL)} repo",
        "cd repo",
        f"python -m pip install --no-cache-dir --extra-index-url {shlex.quote(CPU_WHEEL_INDEX)} -r python/requirements.txt",
        (
            "python python/camber_worker.py"
            f" --input {shlex.quote('../' + input_dir + '/' + input_name)}"
            f" --output-dir {shlex.quote('../' + output_dir)}"
            f" --run-id {shlex.quote(run_id)}"
            f" --title {shlex.quote(args.title or input_path.stem)}"
            f" --composer {shlex.quote(args.composer)}"
            f" --tempo {int(args.tempo)}"
            f" --audio-format {shlex.quote(args.audio_format)}"
            f" --voice {shlex.quote(args.voice)}"
            + (" --metronome" if args.metronome else "")
        ),
    ]
    command = " && ".join(command_parts)

    job = camber.base.create_job(
        command=command,
        node_size="XXSMALL",
        extra_env_vars={
            "CHOIRMATE_RUN_ID": run_id,
            # Keep the first test deterministic and avoid an unrequested model download.
            # The existing service still produces structured, data-grounded explanations.
            "SMOLLM2_ENABLED": "0",
            "SMOLLM2_AUTO_DOWNLOAD": "0",
        },
        tags=["choirmate", run_id],
    )

    print("Camber job submitted.")
    print(f"job_id: {job.job_id}")
    print(f"run_id: {run_id}")
    print(f"input_stash_path: {input_dir}/{input_name}")
    print(f"output_stash_path: {output_dir}")
    print(f"initial_status: {job.status}")
    print("Save both job_id and run_id. Check status before retrieving outputs.")


def show_status(args: argparse.Namespace) -> None:
    import camber

    job = camber.job.get_job(job_id=args.job_id)
    print(f"job_id: {job.job_id}")
    print(f"status: {job.status}")
    try:
        job.read_logs(tail_lines=80)
    except Exception as exc:
        print(f"Could not read logs yet: {exc}")


def retrieve(args: argparse.Namespace) -> None:
    import camber
    import camber.stash

    if not args.confirm_complete:
        raise SystemExit(
            "Refusing to retrieve outputs until you confirm the Camber dashboard shows the job completed. "
            "Re-run with --confirm-complete after checking its status."
        )

    job = camber.job.get_job(job_id=args.job_id)
    status_value = str(job.status).upper()
    if "FAIL" in status_value or "CANCEL" in status_value:
        try:
            job.read_logs(tail_lines=120)
        finally:
            raise SystemExit(f"Job is not successful (status: {job.status}); output was not retrieved.")

    source = f"choirmate/jobs/{args.run_id}/output"
    destination = str(Path(args.destination).expanduser().resolve() / args.run_id)
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    camber.stash.private.cp(src_path=source, dest_path=destination, recursive=True)

    output_path = Path(destination)
    if not output_path.exists() or not any(p.is_file() for p in output_path.rglob("*")):
        raise RuntimeError(
            "The Stash copy returned but no output files were found. Check the job logs and Stash path."
        )

    print(f"Retrieved output folder: {output_path}")
    for file_path in sorted(p for p in output_path.rglob("*") if p.is_file()):
        print(f"- {file_path.relative_to(output_path)} ({file_path.stat().st_size} bytes)")


def main() -> None:
    args = build_parser().parse_args()
    if args.action == "submit":
        submit(args)
    elif args.action == "status":
        show_status(args)
    elif args.action == "retrieve":
        retrieve(args)


if __name__ == "__main__":
    main()
