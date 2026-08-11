import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('FinFlow API')
    .setDescription(
      'Gestao financeira com projecao de faturas e fluxo de caixa. ' +
        'Todos os valores monetarios sao inteiros em CENTAVOS. ' +
        'Datas de negocio usam o formato YYYY-MM-DD e competencias YYYY-MM.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.PORT ?? 3333);
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`API em http://localhost:${port}/api`);
  logger.log(`Documentacao em http://localhost:${port}/docs`);
}

void bootstrap();
