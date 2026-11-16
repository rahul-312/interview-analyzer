import pytest

from config import database


def test_pooled_neon_url():
    db = database.from_url(
        "postgresql://neondb_owner:p%40ss@ep-cool-name-a1b2-pooler.ap-southeast-1.aws.neon.tech/neondb"
        "?sslmode=require&channel_binding=require"
    )
    assert db["ENGINE"] == "django.db.backends.postgresql"
    assert db["HOST"] == "ep-cool-name-a1b2-pooler.ap-southeast-1.aws.neon.tech"
    assert db["PORT"] == "5432"
    assert db["NAME"] == "neondb"
    assert db["USER"] == "neondb_owner"
    assert db["PASSWORD"] == "p@ss"  # percent-encoded characters are decoded
    assert db["OPTIONS"] == {"sslmode": "require", "channel_binding": "require"}
    assert db["DISABLE_SERVER_SIDE_CURSORS"] is True
    assert db["CONN_MAX_AGE"] == 60


def test_direct_url_keeps_server_side_cursors_and_port():
    db = database.from_url("postgres://u:p@ep-cool-name-a1b2.aws.neon.tech:6543/app?sslmode=require")
    assert db["PORT"] == "6543"
    assert db["DISABLE_SERVER_SIDE_CURSORS"] is False


@pytest.mark.parametrize("url", [
    "mysql://u:p@host/db",
    "postgresql://u:p@host/",
    "postgresql:///db",
])
def test_rejects_unusable_urls(url):
    with pytest.raises(ValueError):
        database.from_url(url)
