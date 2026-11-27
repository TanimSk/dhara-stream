"""Shared DRF pieces: response envelope, exception handler, pagination."""

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import exception_handler


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None

    data = response.data
    if isinstance(data, dict):
        parts = []
        for field, messages in data.items():
            if field in ("detail", "non_field_errors"):
                parts.extend(str(m) for m in (messages if isinstance(messages, list) else [messages]))
            elif isinstance(messages, list):
                parts.extend(f"({field}) {m}" for m in messages)
            else:
                parts.append(f"({field}) {messages}")
        message = "\n".join(parts)
    elif isinstance(data, list):
        message = "\n".join(str(m) for m in data)
    else:
        message = str(data)

    response.data = {"success": False, "message": message}
    return response


def ok(message="OK", status=200, **data):
    return Response({"success": True, "message": message, **data}, status=status)


def fail(message, status=400):
    return Response({"success": False, "message": message}, status=status)


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 24
    page_size_query_param = "page_size"
    max_page_size = 200
    page_query_param = "p"

    def get_paginated_response(self, data):
        return Response(
            {
                "success": True,
                "count": self.page.paginator.count,
                "page_size": self.get_page_size(self.request),
                "num_pages": self.page.paginator.num_pages,
                "current_page": self.page.number,
                "next": self.get_next_link(),
                "previous": self.get_previous_link(),
                "results": data,
            }
        )


def paginate(view, request, queryset, serializer_class, **ser_kwargs):
    paginator = StandardResultsSetPagination()
    page = paginator.paginate_queryset(queryset, request, view=view)
    return paginator.get_paginated_response(serializer_class(page, many=True, **ser_kwargs).data)
