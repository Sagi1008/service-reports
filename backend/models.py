from sqlalchemy import Column, ForeignKey, Integer, String, DateTime
from sqlalchemy.orm import DeclarativeBase, relationship
from datetime import datetime, timezone


class Base(DeclarativeBase):
    pass


class ServiceReport(Base):
    __tablename__ = "service_reports"

    id               = Column(Integer, primary_key=True, index=True)
    technician_name  = Column(String, nullable=False, default="")
    customer_name    = Column(String, nullable=False, default="")
    work_description = Column(String, nullable=False, default="")
    status           = Column(String, nullable=False, default="pending")
    created_at       = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    report_data      = Column(String, nullable=True)   # full report JSON stored as text

    attachments      = relationship("Attachment", back_populates="report", cascade="all, delete-orphan")


class AppConfig(Base):
    """Key-value store for shared app state (folders, templates, taskCounter)."""
    __tablename__ = "app_config"

    key   = Column(String, primary_key=True)
    value = Column(String, nullable=False, default="{}")  # JSON text


class Attachment(Base):
    __tablename__ = "attachments"

    id          = Column(Integer, primary_key=True, index=True)
    filename    = Column(String, nullable=False)
    file_path   = Column(String, nullable=False)
    file_type   = Column(String, nullable=False, default="")
    folder_id   = Column(String, nullable=True, index=True)   # folder this doc belongs to
    template_id = Column(String, nullable=True, index=True)   # frontend template UID
    report_id   = Column(Integer, ForeignKey("service_reports.id"), nullable=True, index=True)
    created_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    report      = relationship("ServiceReport", back_populates="attachments")
