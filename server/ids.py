"""Stable, URL-safe ID generation for VibePod entities."""

import secrets


def _make_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(8)}"


def gen_id() -> str:
    return _make_id("gen")


def proj_id() -> str:
    return _make_id("proj")


def asset_id() -> str:
    return _make_id("asset")


def track_id() -> str:
    return _make_id("track")


def clip_id() -> str:
    return _make_id("clip")


def block_id() -> str:
    return _make_id("block")


def take_id() -> str:
    return _make_id("take")
