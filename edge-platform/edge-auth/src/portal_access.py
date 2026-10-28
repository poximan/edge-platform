class PortalAccess:
    """El antecedente del landing no contiene autorizacion de productos."""

    def __init__(self, registry, catalog):
        self.registry, self.catalog = registry, catalog

    def allows(self, ip, uri):
        return self.catalog.page(uri) is None or self.registry.known(ip)
