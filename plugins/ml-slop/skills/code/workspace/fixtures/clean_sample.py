"""User records processing utilities."""
import json


def is_valid(record):
    return (
        isinstance(record, dict)
        and "name" in record
        and "@" in record.get("email", "")
    )


def process_records(records, audit_path="audit.log"):
    valid = [r for r in records if is_valid(r)]
    with open(audit_path, "a") as f:
        f.writelines(json.dumps(r) + "\n" for r in valid)
    return [{"name": r["name"], "email": r["email"]} for r in valid]
