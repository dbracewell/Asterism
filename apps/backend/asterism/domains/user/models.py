from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base


class UserModel(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(
        "id",
        String,
        primary_key=True,
    )
