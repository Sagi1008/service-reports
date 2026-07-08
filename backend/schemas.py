from pydantic import BaseModel
from datetime import datetime
from typing import Any


class AttachmentResponse(BaseModel):
    id:          int
    filename:    str
    file_path:   str
    file_type:   str
    folder_id:   str | None = None
    template_id: str | None = None
    report_id:   int | None = None
    created_at:  datetime

    model_config = {"from_attributes": True}


class ReportCreate(BaseModel):
    technician_name:  str = ""
    customer_name:    str = ""
    work_description: str = ""
    status:           str = "pending"
    report_data:      Any = None   # accepts dict or None; serialised to JSON in the endpoint


class ReportResponse(BaseModel):
    id:               int
    technician_name:  str
    customer_name:    str
    work_description: str
    status:           str
    created_at:       datetime
    report_data:      Any = None   # deserialised back to dict/list when returned
    attachments:      list[AttachmentResponse] = []

    model_config = {"from_attributes": True}
