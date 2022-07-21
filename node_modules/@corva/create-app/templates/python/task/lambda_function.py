from corva import Api, Logger, TaskEvent, task


@task
def lambda_handler(event: TaskEvent, api: Api):
    """Insert your logic here"""
    Logger.info('Hello, World!')
