#!/usr/bin/env python3
"""Generate the dynamic sections of README.md from the GitHub REST API.

Sections produced (each lives between its own marker comment pair in README.md):
  1. commits    - last 5 commits across all PUBLIC repos only (see privacy note below)
  2. languages  - aggregate language byte breakdown across public + private repos
  3. loc        - total lines changed (additions + deletions) since Jan 1 of the current year,
                  across public + private repos
  4. art        - a small deterministic SVG generated from the last 30 days of commit activity,
                  across public + private repos

Auth: with just the workflow's default GITHUB_TOKEN, only public repos are
visible (GITHUB_TOKEN can't list or read someone's other repos). To include
private repos in the aggregate sections, set the PROFILE_TOKEN env var to a
Personal Access Token belonging to the account, with the classic 'repo' scope
(fine-grained: Contents + Metadata read on all repos). Store it as a repo
secret (e.g. PROFILE_STATS_TOKEN) and pass it through in the workflow - see
update-readme.yml. If PROFILE_TOKEN isn't set, everything falls back to the
public-only behavior automatically.

Privacy note: "Latest commits" always filters to public-repo events only
(GitHub tags each event with a `public` flag), even when PROFILE_TOKEN grants
private access - repo names and commit messages from private repos are never
written into this public README. The other three sections only ever surface
aggregate numbers (percentages, a total, bar heights) with no repo names or
messages, so private-repo data contributing to them doesn't leak identifying
details.

Design notes / known limitations (documented rather than hidden):
  - "Latest commits" and the art data both come from the events API
    (/users/{owner}/events or /users/{owner}/events/public), which GitHub only
    retains for ~90 days / the most recent 300 events. That's plenty for
    "last 5 commits" and "last 30 days", but it's not a complete history.
  - "Lines of code this year" walks each repo's commit list since Jan 1 and
    fetches per-commit stats. That's one API call per commit, which is capped
    per repo (MAX_COMMITS_PER_REPO_FOR_STATS) so a single very active repo
    can't exhaust the run's rate limit budget. The number is therefore a
    bounded approximation for very high-activity accounts, not a guaranteed
    exact total.
"""

import hashlib
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

API_ROOT = "https://api.github.com"
REPO_ROOT = Path(__file__).resolve().parent.parent
README_PATH = REPO_ROOT / "README.md"
ART_PATH = REPO_ROOT / "assets" / "daily-art.svg"

COMMITS_TO_SHOW = 5
TOP_LANGUAGES_TO_SHOW = 6
ART_DAYS = 30
MAX_COMMITS_PER_REPO_FOR_STATS = 200  # bounds API usage for the "lines of code" section
EVENTS_PAGES_TO_SCAN = 10  # 10 * 100 = up to 1000 events (API caps at ~300 anyway)


def log(msg):
    print(msg, file=sys.stderr)


class GitHubClient:
    """Thin wrapper around requests that understands GitHub rate limiting.

    Rather than crashing the whole run on a 401/403, calls return None so
    callers can fall back to "keep whatever was already in the README".
    """

    def __init__(self, token):
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        if token:
            self.session.headers["Authorization"] = f"Bearer {token}"
        self.rate_limited = False

    def get(self, url, params=None):
        if self.rate_limited:
            return None
        try:
            resp = self.session.get(url, params=params, timeout=30)
        except requests.RequestException as exc:
            log(f"WARNING: request to {url} failed: {exc}")
            return None

        if resp.status_code == 401:
            log("WARNING: GitHub API returned 401 Unauthorized - check GITHUB_TOKEN. "
                "Skipping remaining API-dependent sections.")
            self.rate_limited = True
            return None

        if resp.status_code == 403 and resp.headers.get("X-RateLimit-Remaining") == "0":
            reset = resp.headers.get("X-RateLimit-Reset")
            log(f"WARNING: GitHub API rate limit hit (resets at epoch {reset}). "
                "Skipping remaining API-dependent sections.")
            self.rate_limited = True
            return None

        if resp.status_code == 403:
            log(f"WARNING: 403 from {url}: {resp.text[:200]}")
            return None

        if resp.status_code == 404:
            return None

        if resp.status_code == 202:
            # Commit stats are being computed asynchronously; treat as unavailable
            # rather than blocking the whole run on a retry loop.
            return None

        if not resp.ok:
            log(f"WARNING: {resp.status_code} from {url}: {resp.text[:200]}")
            return None

        return resp

    def get_json(self, url, params=None):
        resp = self.get(url, params=params)
        return resp.json() if resp is not None else None

    def paginate(self, url, params=None, max_pages=20):
        params = dict(params or {})
        params.setdefault("per_page", 100)
        page = 1
        while page <= max_pages:
            params["page"] = page
            data = self.get_json(url, params=params)
            if not data:
                break
            for item in data:
                yield item
            if len(data) < params["per_page"]:
                break
            page += 1


def get_owner():
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" in repo:
        return repo.split("/", 1)[0]
    owner = os.environ.get("GITHUB_REPOSITORY_OWNER")
    if owner:
        return owner
    raise SystemExit("Could not determine repo owner from GITHUB_REPOSITORY env var")


def fetch_repos(gh, owner, include_private):
    if include_private:
        # Authenticated "repos for the current user" endpoint - includes private
        # repos, but only ones PROFILE_TOKEN's owner actually owns/can see.
        repos = list(gh.paginate(
            f"{API_ROOT}/user/repos",
            params={"affiliation": "owner", "visibility": "all", "sort": "pushed"},
        ))
    else:
        repos = list(gh.paginate(
            f"{API_ROOT}/users/{owner}/repos",
            params={"type": "owner", "sort": "pushed"},
        ))
    # Only the account owner's own (non-fork) repos count toward these stats.
    return [r for r in repos if not r.get("fork") and not r.get("archived")]


def relative_time(dt):
    now = datetime.now(timezone.utc)
    delta = now - dt
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return "just now"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    days = hours // 24
    if days < 30:
        return f"{days} day{'s' if days != 1 else ''} ago"
    months = days // 30
    if months < 12:
        return f"{months} month{'s' if months != 1 else ''} ago"
    years = months // 12
    return f"{years} year{'s' if years != 1 else ''} ago"


def fetch_push_events(gh, owner, include_private, max_pages=EVENTS_PAGES_TO_SCAN):
    """PushEvents for the user, newest first (as returned by the API).

    With include_private, uses the authenticated /events endpoint, which
    includes private-repo events when the token belongs to `owner`. Each
    event still carries a `public` flag callers can filter on.
    """
    path = "events" if include_private else "events/public"
    events = list(gh.paginate(
        f"{API_ROOT}/users/{owner}/{path}",
        max_pages=max_pages,
    ))
    return [e for e in events if e.get("type") == "PushEvent"]


def build_commits_section(push_events):
    # Privacy: regardless of whether push_events includes private-repo activity
    # (see fetch_push_events), never surface private repo names or commit
    # messages in this publicly-visible section.
    commits = []
    for event in push_events:
        if not event.get("public", True):
            continue
        repo_name = event.get("repo", {}).get("name", "")
        created_at = event.get("created_at")
        try:
            created_dt = datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
        for commit in event.get("payload", {}).get("commits", []):
            if not commit.get("distinct", True):
                continue
            message = commit.get("message", "").split("\n")[0].strip()
            sha = commit.get("sha", "")
            if not message or not sha or not repo_name:
                continue
            commits.append({
                "repo": repo_name,
                "message": message,
                "sha": sha,
                "created_at": created_dt,
            })

    commits.sort(key=lambda c: c["created_at"], reverse=True)
    top = commits[:COMMITS_TO_SHOW]

    if not top:
        return "_No recent public commit activity found._"

    lines = []
    for c in top:
        short_sha = c["sha"][:7]
        url = f"https://github.com/{c['repo']}/commit/{c['sha']}"
        when = relative_time(c["created_at"])
        lines.append(f"- **{c['repo']}**: [{c['message']}]({url}) (`{short_sha}`, {when})")
    return "\n".join(lines)


def build_language_section(gh, owner, repos):
    totals = {}
    for repo in repos:
        if gh.rate_limited:
            break
        data = gh.get_json(f"{API_ROOT}/repos/{owner}/{repo['name']}/languages")
        if not data:
            continue
        for lang, byte_count in data.items():
            totals[lang] = totals.get(lang, 0) + byte_count

    if not totals:
        return "_No language data available._"

    total_bytes = sum(totals.values())
    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)

    top = ranked[:TOP_LANGUAGES_TO_SHOW]
    rest = ranked[TOP_LANGUAGES_TO_SHOW:]

    parts = [f"{lang} {100 * byte_count / total_bytes:.1f}%" for lang, byte_count in top]
    if rest:
        rest_bytes = sum(b for _, b in rest)
        parts.append(f"Other {100 * rest_bytes / total_bytes:.1f}%")

    return " | ".join(parts)


def build_loc_section(gh, owner, repos):
    year_start = datetime(datetime.now(timezone.utc).year, 1, 1, tzinfo=timezone.utc)
    since_param = year_start.strftime("%Y-%m-%dT%H:%M:%SZ")

    total_changed = 0
    counted_any_commit = False
    truncated = False

    for repo in repos:
        if gh.rate_limited:
            truncated = True
            break

        shas = []
        for commit in gh.paginate(
            f"{API_ROOT}/repos/{owner}/{repo['name']}/commits",
            params={"since": since_param, "author": owner},
            max_pages=(MAX_COMMITS_PER_REPO_FOR_STATS // 100) + 1,
        ):
            shas.append(commit["sha"])
            if len(shas) >= MAX_COMMITS_PER_REPO_FOR_STATS:
                truncated = True
                break

        for sha in shas:
            if gh.rate_limited:
                truncated = True
                break
            detail = gh.get_json(f"{API_ROOT}/repos/{owner}/{repo['name']}/commits/{sha}")
            if not detail:
                continue
            stats = detail.get("stats", {})
            total_changed += stats.get("additions", 0) + stats.get("deletions", 0)
            counted_any_commit = True

    if not counted_any_commit:
        return "_No commit data available for this year yet._"

    suffix = "+" if truncated else ""
    year = datetime.now(timezone.utc).year
    return f"**{total_changed:,}{suffix}** lines changed in {year}"


def build_art_svg(push_events):
    now = datetime.now(timezone.utc).date()
    day_counts = {}
    for event in push_events:
        created_at = event.get("created_at")
        try:
            created_date = datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%SZ").date()
        except (TypeError, ValueError):
            continue
        age_days = (now - created_date).days
        if 0 <= age_days < ART_DAYS:
            commit_count = len(event.get("payload", {}).get("commits", []))
            day_counts[created_date] = day_counts.get(created_date, 0) + commit_count

    days = [now - timedelta(days=offset) for offset in range(ART_DAYS - 1, -1, -1)]
    counts = [day_counts.get(d, 0) for d in days]
    max_count = max(counts) if any(counts) else 1

    bar_width = 10
    gap = 2
    max_bar_height = 40
    padding = 4
    width = ART_DAYS * (bar_width + gap) - gap + padding * 2
    height = max_bar_height + padding * 2

    bars = []
    for i, (day, count) in enumerate(zip(days, counts)):
        # Deterministic color per day, seeded from the date itself so the art
        # is reproducible for a given commit history rather than random.
        digest = hashlib.sha256(day.isoformat().encode()).hexdigest()
        hue = int(digest[:3], 16) % 360
        lightness = 35 + (count / max_count) * 25 if max_count else 35
        color = f"hsl({hue}, 65%, {lightness:.0f}%)"

        bar_height = max(2, (count / max_count) * max_bar_height) if max_count else 2
        x = padding + i * (bar_width + gap)
        y = padding + (max_bar_height - bar_height)
        bars.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_width}" height="{bar_height:.1f}" '
            f'rx="1.5" fill="{color}"><title>{day.isoformat()}: {count} commit(s)</title></rect>'
        )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-label="Commit activity, last {ART_DAYS} days">'
        + "".join(bars)
        + "</svg>"
    )
    return svg


def replace_section(readme_text, marker, new_content):
    start_marker = f"<!--START_SECTION:{marker}-->"
    end_marker = f"<!--END_SECTION:{marker}-->"
    pattern = re.compile(
        re.escape(start_marker) + r".*?" + re.escape(end_marker),
        re.DOTALL,
    )
    replacement = f"{start_marker}\n{new_content}\n{end_marker}"
    if not pattern.search(readme_text):
        log(f"WARNING: markers for '{marker}' not found in README.md; skipping")
        return readme_text
    return pattern.sub(replacement, readme_text)


def main():
    profile_token = os.environ.get("PROFILE_TOKEN", "")
    token = profile_token or os.environ.get("GITHUB_TOKEN", "")
    include_private = bool(profile_token)

    if not token:
        log("WARNING: no token set; API calls will be unauthenticated and heavily rate limited")
    log(f"Private-repo aggregation: {'ON (PROFILE_TOKEN set)' if include_private else 'OFF (public repos only)'}")

    owner = get_owner()
    gh = GitHubClient(token)

    log(f"Fetching repos for {owner}...")
    repos = fetch_repos(gh, owner, include_private)
    log(f"Found {len(repos)} non-fork repos ({'public + private' if include_private else 'public only'})")

    log("Fetching push events...")
    push_events = fetch_push_events(gh, owner, include_private)

    readme_text = README_PATH.read_text(encoding="utf-8")

    log("Building 'latest commits' section...")
    readme_text = replace_section(readme_text, "commits", build_commits_section(push_events))

    log("Building 'language breakdown' section...")
    readme_text = replace_section(readme_text, "languages", build_language_section(gh, owner, repos))

    log("Building 'lines of code this year' section...")
    readme_text = replace_section(readme_text, "loc", build_loc_section(gh, owner, repos))

    log("Building generative art...")
    ART_PATH.parent.mkdir(parents=True, exist_ok=True)
    ART_PATH.write_text(build_art_svg(push_events), encoding="utf-8")
    art_content = (
        f'<img src="assets/daily-art.svg" alt="Commit activity art, last {ART_DAYS} days" />'
    )
    readme_text = replace_section(readme_text, "art", art_content)

    README_PATH.write_text(readme_text, encoding="utf-8")
    log("Done.")


if __name__ == "__main__":
    main()
