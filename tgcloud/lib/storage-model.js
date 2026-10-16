// Physical columns of the existing SQLite schema. No credentials.
export const storageModel = {
  "settings": {
    "name": "settings",
    "fields": {
      "key": {
        "name": "key",
        "type": "text",
        "timestamp": false
      },
      "value": {
        "name": "value",
        "type": "json",
        "timestamp": false
      }
    }
  },
  "leases": {
    "name": "leases",
    "fields": {
      "key": {
        "name": "key",
        "type": "text",
        "timestamp": false
      },
      "until": {
        "name": "until",
        "type": "integer",
        "timestamp": false
      }
    }
  },
  "snapshots": {
    "name": "snapshots",
    "fields": {
      "key": {
        "name": "key",
        "type": "text",
        "timestamp": false
      },
      "value": {
        "name": "value",
        "type": "json",
        "timestamp": false
      },
      "reader": {
        "name": "reader",
        "type": "text",
        "timestamp": false
      },
      "updatedAt": {
        "name": "updated_at",
        "type": "integer",
        "timestamp": true
      }
    }
  },
  "accounts": {
    "name": "accounts",
    "fields": {
      "id": {
        "name": "id",
        "type": "text",
        "timestamp": false
      },
      "ownerId": {
        "name": "owner_id",
        "type": "integer",
        "timestamp": false
      },
      "label": {
        "name": "label",
        "type": "text",
        "timestamp": false
      },
      "mode": {
        "name": "mode",
        "type": "text",
        "timestamp": false
      },
      "secret": {
        "name": "secret",
        "type": "text",
        "timestamp": false
      },
      "enabled": {
        "name": "enabled",
        "type": "boolean",
        "timestamp": false
      },
      "health": {
        "name": "health",
        "type": "json",
        "timestamp": false
      },
      "createdAt": {
        "name": "created_at",
        "type": "integer",
        "timestamp": true
      },
      "updatedAt": {
        "name": "updated_at",
        "type": "integer",
        "timestamp": true
      }
    }
  },
  "contributors": {
    "name": "contributors",
    "fields": {
      "tgId": {
        "name": "tg_id",
        "type": "integer",
        "timestamp": false
      },
      "label": {
        "name": "label",
        "type": "text",
        "timestamp": false
      },
      "approved": {
        "name": "approved",
        "type": "boolean",
        "timestamp": false
      },
      "approvedBy": {
        "name": "approved_by",
        "type": "integer",
        "timestamp": false
      },
      "approvedAt": {
        "name": "approved_at",
        "type": "integer",
        "timestamp": true
      },
      "createdAt": {
        "name": "created_at",
        "type": "integer",
        "timestamp": true
      }
    }
  },
  "professors": {
    "name": "professors",
    "fields": {
      "code": {
        "name": "code",
        "type": "text",
        "timestamp": false
      },
      "name": {
        "name": "name",
        "type": "text",
        "timestamp": false
      },
      "updatedBy": {
        "name": "updated_by",
        "type": "integer",
        "timestamp": false
      },
      "updatedAt": {
        "name": "updated_at",
        "type": "integer",
        "timestamp": true
      }
    }
  },
  "classBindings": {
    "name": "class_bindings",
    "fields": {
      "key": {
        "name": "key",
        "type": "text",
        "timestamp": false
      },
      "code": {
        "name": "code",
        "type": "text",
        "timestamp": false
      },
      "label": {
        "name": "label",
        "type": "text",
        "timestamp": false
      },
      "professorCode": {
        "name": "professor_code",
        "type": "text",
        "timestamp": false
      },
      "professorName": {
        "name": "professor_name",
        "type": "text",
        "timestamp": false
      },
      "slots": {
        "name": "slots",
        "type": "json",
        "timestamp": false
      },
      "source": {
        "name": "source",
        "type": "text",
        "timestamp": false
      },
      "updatedBy": {
        "name": "updated_by",
        "type": "integer",
        "timestamp": false
      },
      "updatedAt": {
        "name": "updated_at",
        "type": "integer",
        "timestamp": true
      }
    }
  },
  "notices": {
    "name": "notices",
    "fields": {
      "key": {
        "name": "key",
        "type": "text",
        "timestamp": false
      },
      "sentAt": {
        "name": "sent_at",
        "type": "integer",
        "timestamp": false
      },
      "count": {
        "name": "count",
        "type": "integer",
        "timestamp": false
      },
      "info": {
        "name": "info",
        "type": "json",
        "timestamp": false
      }
    }
  },
  "subscriptions": {
    "name": "subscriptions",
    "fields": {
      "tgId": {
        "name": "tg_id",
        "type": "integer",
        "timestamp": false
      },
      "active": {
        "name": "active",
        "type": "boolean",
        "timestamp": false
      },
      "profile": {
        "name": "profile",
        "type": "json",
        "timestamp": false
      },
      "seen": {
        "name": "seen",
        "type": "json",
        "timestamp": false
      }
    }
  }
};
