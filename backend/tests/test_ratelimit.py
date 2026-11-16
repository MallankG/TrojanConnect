import pytest

from app.integrations.gemini.ratelimit import RateLimited, RateLimiter


def test_window_paces_then_frees_slots():
    now = [0.0]
    rl = RateLimiter(2, clock=lambda: now[0])
    assert [rl.reserve(), rl.reserve()] == [0.0, 0.0]
    assert rl.reserve() == 60.0   # third call waits for the first slot to leave the window
    assert rl.reserve() == 60.0   # fourth pairs with the second
    assert rl.reserve() == 120.0  # queued calls keep the rate, they do not burst
    now[0] = 200.0
    assert rl.reserve() == 0.0


def test_max_wait_raises_429_without_booking_and_zero_disables():
    rl = RateLimiter(1, max_wait=10, clock=lambda: 0.0)
    rl.reserve()
    with pytest.raises(RateLimited) as exc:
        rl.reserve()
    assert exc.value.code == 429 and len(rl._slots) == 1
    off = RateLimiter(0, clock=lambda: 0.0)
    assert [off.reserve() for _ in range(50)] == [0.0] * 50


def test_api_429_with_retry_delay_blocks_until_it_passes():
    now = [0.0]
    rl = RateLimiter(10, max_wait=10, clock=lambda: now[0])
    err = Exception("429")
    err.code, err.details = 429, {"error": {"details": [{"retryDelay": "19323s"}]}}
    rl.penalize(err)
    with pytest.raises(RateLimited):
        rl.reserve()
    now[0] = 19320.0
    assert rl.reserve() == 3.0  # short enough to wait out
    rl.penalize(Exception("no code, ignored"))
