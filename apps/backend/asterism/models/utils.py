import datetime


def now():
    return int(datetime.datetime.now(tz=datetime.timezone.utc).timestamp())
