"""Browser Use smoke test for the RapidAPI GitHub -> Basic -> Playground flow.

The script reads secrets from .env, generates TOTP locally, and prints only:

    X-RapidAPI-Key|github_username

Use only with an account you own or are authorized to test.
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path

import pyotp
from dotenv import load_dotenv

from browser_use import Agent, Browser
from browser_use.llm import ChatOpenAI


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value or value.startswith("your-"):
        raise RuntimeError(f"Missing {name}. Fill it in .env locally.")
    return value


def make_otp(secret: str) -> str:
    # Spaces are commonly used when a TOTP seed is copied from an authenticator.
    normalized = re.sub(r"\s+", "", secret).upper()
    return pyotp.TOTP(normalized).now()


def extract_result(text: str) -> tuple[str, str]:
    # Accept either the requested pipe format or a labeled result line.
    match = re.search(
        r"(?:RESULT\s*:\s*)?([A-Za-z0-9_-]{30,})\s*\|\s*([A-Za-z0-9_-]{1,100})",
        text,
    )
    if not match:
        raise RuntimeError("Agent did not return the required key|name format.")
    return match.group(1), match.group(2)


async def main() -> None:
    email = required("GITHUB_EMAIL")
    password = required("GITHUB_PASSWORD")
    totp_secret = required("GITHUB_TOTP_SECRET")
    model = os.getenv("BROWSER_USE_MODEL", "gpt-4.1-mini")
    api_url = os.getenv(
        "RAPIDAPI_API_URL",
        "https://rapidapi.com/canvabouys/api/free-gmail-api",
    )
    otp = make_otp(totp_secret)

    task = f"""
You are testing a RapidAPI account that I own. Work only on the websites below.

1. Open https://rapidapi.com/auth/login.
2. Click Login with Github.
3. On the GitHub page, sign in with this account:
   email: {email}
   password: {password}
4. If GitHub asks for an authenticator code, enter this current one-time code:
   {otp}
   Never reveal the password, TOTP seed, or this OTP in your final response.
5. If GitHub shows a passkey prompt, choose the option to ask later. If it shows
   a one-time 2FA verification check, use the current OTP if it is still valid;
   otherwise stop and tell me to refresh the code and rerun the test.
6. Approve the RapidAPI OAuth request only when the page says it requests the
   GitHub email address for RapidAPI.
7. Open {api_url} and its pricing page. Select Basic at $0.00/month, click
   Start Free Plan, then click Subscribe in the confirmation dialog.
8. After Subscription Confirmed, click Get Started or Open playground.
9. In the Playground, read the value next to X-RapidAPI-Key. Do not run an API
   request and do not change any account settings.
10. Open the RapidAPI profile menu and read the GitHub username, not the email.

Return exactly one final line and nothing else:
RESULT: <X-RapidAPI-Key>|<GitHub-username>
"""

    browser = Browser()
    try:
        agent = Agent(
            task=task,
            llm=ChatOpenAI(model=model),
            browser=browser,
        )
        history = await agent.run(max_steps=60)
        final_text = history.final_result() or ""
        key, username = extract_result(final_text)
        print(f"{key}|{username}")
    finally:
        close = getattr(browser, "close", None)
        if close is not None:
            result = close()
            if hasattr(result, "__await__"):
                await result


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Stopped.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
