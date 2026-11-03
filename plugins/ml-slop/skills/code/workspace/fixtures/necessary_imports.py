import json
from collections import Counter
from pathlib import PurePath


def suffix_counts(paths: list[str]) -> str:
    counts = Counter(PurePath(path).suffix for path in paths)
    return json.dumps(counts, sort_keys=True)
