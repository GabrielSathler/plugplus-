import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { AuthModule } from './auth/auth.module';
import { Public } from './auth/auth.types';
import { DomainModule } from './domain/domain.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AccountsModule } from './modules/accounts.module';
import { BudgetsModule } from './modules/budgets.module';
import { CategoriesModule } from './modules/categories.module';
import { CreditCardsModule } from './modules/credit-cards.module';
import { DashboardModule } from './modules/dashboard.module';
import { PlansModule } from './modules/plans.module';
import { ProjectionsModule } from './modules/projections.module';
import { RecurrencesModule } from './modules/recurrences.module';
import { ScenariosModule } from './modules/scenarios.module';
import { SettingsModule } from './modules/settings.module';
import { TransactionsModule } from './modules/transactions.module';
import { PrismaModule } from './prisma/prisma.module';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', service: 'finflow-api', timestamp: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    DomainModule,
    AccountsModule,
    CreditCardsModule,
    CategoriesModule,
    TransactionsModule,
    RecurrencesModule,
    BudgetsModule,
    ScenariosModule,
    PlansModule,
    ProjectionsModule,
    DashboardModule,
    SettingsModule,
    IntegrationsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
