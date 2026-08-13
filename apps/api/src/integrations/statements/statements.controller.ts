import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Ctx, type RequestContext } from '../../auth/auth.types';
import { StatementService, type StatementFormat } from './statement.service';

export class CommitEntryDto {
  @IsString() date!: string;
  @IsString() @MaxLength(160) description!: string;
  /** CENTAVOS, positivo. */
  @IsInt() @Min(1) amount!: number;
  @IsIn(['INCOME', 'EXPENSE']) type!: string;
}

export class CommitStatementDto {
  @IsString() accountId!: string;
  @IsIn(['OFX', 'CSV', 'PDF']) format!: string;
  @IsString() fileHash!: string;
  @IsString() @MaxLength(200) filename!: string;
  @IsOptional() @IsString() @MaxLength(80) bank?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CommitEntryDto)
  entries!: CommitEntryDto[];
}

/**
 * Importação de extrato.
 *
 * DOIS PASSOS, e a separação é o ponto: `preview` lê o arquivo e devolve um
 * rascunho sem gravar nada; `commit` grava só o que a pessoa confirmou. PDF é
 * reconstruído de glifos posicionados e erra em silêncio — num produto
 * financeiro, importar em um clique seria a decisão errada.
 *
 * O ARQUIVO NÃO É GUARDADO. Ele chega em multipart, é lido em memória e
 * descartado no fim da requisição. Fica o hash e os metadados, que bastam para
 * deduplicar, auditar e desfazer.
 */
@ApiTags('statements')
@Controller('statements')
export class StatementsController {
  constructor(private readonly statements: StatementService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Lê o extrato e devolve o rascunho para revisão. Não grava nada.' })
  @UseInterceptors(
    FileInterceptor('file', {
      // `storage` ausente = memória. O arquivo NUNCA toca o disco: não sobra
      // extrato bancário em /tmp esperando alguém achar.
      limits: {
        // Extrato mensal fica entre 150 KB e 800 KB; 10 MB cobre um ano inteiro
        // e ainda barra upload absurdo antes de gastar memória.
        fileSize: 10 * 1024 * 1024,
        files: 1,
      },
      fileFilter: (_req, file, callback) => {
        const allowed = ['.pdf', '.ofx', '.csv', '.txt'];
        const ok = allowed.some((ext) => file.originalname.toLowerCase().endsWith(ext));
        callback(
          ok ? null : new BadRequestException('Envie um arquivo .pdf, .ofx ou .csv.'),
          ok,
        );
      },
    }),
  )
  preview(
    @Ctx() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('accountId') accountId: string,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    if (!accountId) throw new BadRequestException('Informe a conta de destino.');

    return this.statements.preview({
      organizationId: ctx.organizationId,
      accountId,
      buffer: file.buffer,
      filename: file.originalname,
    });
  }

  @Post('commit')
  @ApiOperation({ summary: 'Grava apenas os lançamentos confirmados na revisão.' })
  commit(@Ctx() ctx: RequestContext, @Body() dto: CommitStatementDto) {
    return this.statements.commit({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      accountId: dto.accountId,
      format: dto.format as StatementFormat,
      fileHash: dto.fileHash,
      filename: dto.filename,
      bank: dto.bank,
      entries: dto.entries,
    });
  }

  @Get('imports')
  @ApiOperation({ summary: 'Histórico de importações — o rastro que substitui o arquivo.' })
  history(@Ctx() ctx: RequestContext) {
    return this.statements.history(ctx.organizationId);
  }

  @Delete('imports/:id')
  @ApiOperation({
    summary: 'Desfaz uma importação, removendo os lançamentos que ela trouxe.',
    description:
      'Existe porque parser de PDF erra. Sem isto, corrigir uma importação ruim seria ' +
      'caçar dezenas de lançamentos a mão no meio do histórico.',
  })
  undo(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.statements.undo(ctx.organizationId, id);
  }
}
