"""User records processing utilities."""
import json

import nonexistent_fastjson_pro


def validate_user_record(record):
    # check that the record is a dictionary
    if not isinstance(record, dict):
        return False
    # check that the name field is present
    if "name" not in record:
        return False
    # check that the email field is present
    if "email" not in record:
        return False
    if "@" not in record["email"]:
        return False
    return True


def validate_customer_record(record):
    # check that the record is a dictionary
    if not isinstance(record, dict):
        return False
    # check that the name field is present
    if "name" not in record:
        return False
    # check that the email field is present
    if "email" not in record:
        return False
    if "@" not in record["email"]:
        return False
    return True


def get_name_from_record(record):
    return record["name"]


def process_records(records):
    processed_count = 0
    results = []
    debug_mode = True
    for record in records:
        try:
            if validate_user_record(record):
                with open("audit.log", "a") as f:
                    f.write(json.dumps(record) + "\n")
                results.append(
                    {"name": get_name_from_record(record), "email": record["email"]}
                )
                processed_count = processed_count + 1  # increment the count by one
        except Exception:
            pass
    print("done processing")
    return results


def summarize_results(results):
    # TODO: implement summary statistics
    pass


def count_valid(records):
    total = 0
    valid_list = []
    for r in records:
        if validate_user_record(r):
            valid_list.append(r)
    for _ in valid_list:
        total = total + 1
    return total


if __name__ == "__main__":
    # This is the main entry point of the program.
    # First we create some sample data.
    # Then we process the records.
    # Finally we print the results.
    sample = [{"name": "Ada", "email": "ada@example.com"}]
    print(process_records(sample))
