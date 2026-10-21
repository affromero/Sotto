"""Isolated review controller process boundaries."""


def admitted_runtime_fixture() -> dict[str, object]:
    return {
        'runtimePolicy': {
            'schemaVersion': 1, 'webHeapMiB': 256, 'workerHeapMiB': 512,
            'helperHeapMiB': 192, 'queueConcurrency': 1,
            'privacyContactEmail': 'me@afromero.co',
        },
        'resources': {
            'webMemoryBytes': 512 * 1024 * 1024,
            'workerMemoryBytes': 1152 * 1024 * 1024,
            'helperMemoryBytes': 384 * 1024 * 1024,
            'backupBudgetBytes': 1048576,
        },
    }
