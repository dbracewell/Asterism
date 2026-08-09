from sqlalchemy import MetaData
from sqlalchemy.orm import declarative_base

from asterism import config

if "sqlite" not in config.DB_CONNECTION:
    metadata_obj = MetaData(schema=config.DB_SCHEMA)
else:
    metadata_obj = MetaData()

Base = declarative_base(metadata=metadata_obj)
