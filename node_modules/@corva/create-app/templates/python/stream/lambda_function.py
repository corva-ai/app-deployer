from corva import Api, Cache, Logger, StreamTimeEvent, stream


@stream
def lambda_handler(event: StreamTimeEvent, api: Api, cache: Cache):
    """Insert your logic here"""
    Logger.info('Hello, World!')
