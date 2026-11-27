from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission


class IsMaster(BasePermission):
    message = "Master admin access required."

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.is_master)


class IsClientUser(BasePermission):
    """A signed-in client user whose account isn't suspended. Sets request.client."""

    message = "Client access required."

    def has_permission(self, request, view):
        u = request.user
        if not (u and u.is_authenticated and u.role == u.Role.CLIENT and u.client_id):
            return False
        if not u.client.is_active:
            raise PermissionDenied("This account is suspended. Contact the platform admin.")
        request.client = u.client
        return True
