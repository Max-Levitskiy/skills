"""Dense negative control: concise code can still be functionally wrong."""


def inclusive_sum(start: int, end: int) -> int:
    """Return the sum of every integer from start through end, inclusive."""
    return sum(range(start, end))
