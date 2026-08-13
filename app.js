import { initAuth, checkPassword, logout } from './core/auth.js';
import { loadData } from './core/data.js';
import { goBack } from './core/router.js';
import { openModal, closeModal } from './core/modal.js';
import { openCategory, openView, setSort, applySalesSearch } from './components/sales/sales.js';
import { openCustomersHub, openCustomersYear, openCustomersRolling, openCustomersView, setCustomersSort, openCustomerModal, closeCustomerModal } from './components/customers/customers.js';
import { openReturnsHub, openReturnsMonths, openReturnsCurrentMonth, openReturnsPeriod, openReturnsProducts, openReturnsProductModal, applyReturnsProductsSearch, openReturnsSuppliers, openReturnsSupplierProducts, applyReturnsSupplierProductsSearch, openReturnsIndicator, openReturnsSettlement } from './components/returns/returns.js';
import { openAlertsHub, openAlertsPeriod, filterAlertsBySupplier, applyAlertsSearch } from './components/alerts/alerts.js';
import { openFinanceHub } from './components/finance/finance.js';
import { openCashflowHub, openCashflowTabular, openCashflowYear, openCashflowMonth, applyCashflowFilter, applyCashflowPickedWeek, applyCashflowOverrides } from './components/finance/cashflow.js';
import {
  openSalesBalanceHub, openSalesBalanceCurrentMonth, openSalesBalanceYear, openSalesBalanceMonths,
  openSalesBalancePeriod, applySalesBalancePreset, applySalesBalanceCustomRange, applySalesBalanceSingleDate, applySalesBalancePromoOverride,
  applySalesBalanceCalendarDay, savePromoBudgetDefault, applySalesBalanceOtherCosts, applySalesBalanceReturnsMode, openSalesBalanceSimulation, applySalesBalanceSimMode, runSimulation, saveSimDefault,
  toggleSimKeyEdit, applySimKeyInput, resetSimKeyAssumptions,
} from './components/finance/salesBalance.js';
import { openStockHub, showStockForDate, applyStockChartPeriod, toggleStockChartTable, toggleStockDateResults, applyStockDateSearch } from './components/stock/stock.js';
import { openSuppliersHub, openSuppliersRanking, openSupplierDetail, applySupplierDetailSearch, openSuppliersDemandHub, applySuppliersDemandPeriod } from './components/suppliers/suppliers.js';
import {
  openReorderHub, applyReorderFilter, applyReorderSearch, openReorderProductModal, setReorderSort,
  toggleReorderQtyForm, cancelReorderQty, confirmReorderQty, cartRemoveFromRow,
  toggleReorderSupplierPanel, toggleReorderSupplier, selectAllReorderSuppliers, clearReorderSuppliers,
  applyReorderStockFilter,
  toggleReorderStatusPanel, toggleReorderStatus, selectAllReorderStatuses, clearReorderStatuses,
} from './components/reorder/reorder.js';
import { toggleModalCartQty, cancelModalCartQty, confirmModalCartQty } from './core/modal.js';
import {
  openOrderCart, closeOrderCart, setCartTab, toggleCartCheck, cartRemoveItem,
  sendCartOrder, copyCartMessage, removeSelectedOrdered, updateCartBadge,
  toggleCartSupplierPanel, toggleCartSupplier, selectAllCartSuppliers, clearCartSuppliers,
  toggleCartSelectAllVisible,
} from './components/cart/cart.js';
import { resolveConfirmModal } from './core/confirmModal.js';

window.checkPassword = checkPassword;
window.logout = logout;
window.loadData = loadData;
window.goBack = goBack;
window.openModal = openModal;
window.closeModal = closeModal;
window.openCategory = openCategory;
window.openView = openView;
window.setSort = setSort;
window.applySalesSearch = applySalesSearch;
window.openCustomersHub = openCustomersHub;
window.openCustomersYear = openCustomersYear;
window.openCustomersRolling = openCustomersRolling;
window.openCustomersView = openCustomersView;
window.setCustomersSort = setCustomersSort;
window.openCustomerModal = openCustomerModal;
window.closeCustomerModal = closeCustomerModal;
window.openReturnsHub = openReturnsHub;
window.openReturnsMonths = openReturnsMonths;
window.openReturnsCurrentMonth = openReturnsCurrentMonth;
window.openReturnsPeriod = openReturnsPeriod;
window.openReturnsProducts = openReturnsProducts;
window.openReturnsProductModal = openReturnsProductModal;
window.applyReturnsProductsSearch = applyReturnsProductsSearch;
window.openReturnsSuppliers = openReturnsSuppliers;
window.openReturnsSupplierProducts = openReturnsSupplierProducts;
window.applyReturnsSupplierProductsSearch = applyReturnsSupplierProductsSearch;
window.openReturnsIndicator = openReturnsIndicator;
window.openReturnsSettlement = openReturnsSettlement;
window.openAlertsHub = openAlertsHub;
window.openAlertsPeriod = openAlertsPeriod;
window.filterAlertsBySupplier = filterAlertsBySupplier;
window.applyAlertsSearch = applyAlertsSearch;
window.openFinanceHub = openFinanceHub;
window.openSalesBalanceHub = openSalesBalanceHub;
window.openSalesBalanceCurrentMonth = openSalesBalanceCurrentMonth;
window.openSalesBalanceYear = openSalesBalanceYear;
window.openSalesBalanceMonths = openSalesBalanceMonths;
window.openSalesBalancePeriod = openSalesBalancePeriod;
window.applySalesBalancePreset = applySalesBalancePreset;
window.applySalesBalanceCustomRange = applySalesBalanceCustomRange;
window.applySalesBalanceSingleDate = applySalesBalanceSingleDate;
window.applySalesBalancePromoOverride = applySalesBalancePromoOverride;
window.applySalesBalanceCalendarDay = applySalesBalanceCalendarDay;
window.savePromoBudgetDefault = savePromoBudgetDefault;
window.applySalesBalanceOtherCosts = applySalesBalanceOtherCosts;
window.applySalesBalanceReturnsMode = applySalesBalanceReturnsMode;
window.openSalesBalanceSimulation = openSalesBalanceSimulation;
window.applySalesBalanceSimMode = applySalesBalanceSimMode;
window.runSimulation = runSimulation;
window.saveSimDefault = saveSimDefault;
window.toggleSimKeyEdit = toggleSimKeyEdit;
window.applySimKeyInput = applySimKeyInput;
window.resetSimKeyAssumptions = resetSimKeyAssumptions;
window.openCashflowHub = openCashflowHub;
window.openCashflowTabular = openCashflowTabular;
window.openCashflowYear = openCashflowYear;
window.openCashflowMonth = openCashflowMonth;
window.applyCashflowFilter = applyCashflowFilter;
window.applyCashflowPickedWeek = applyCashflowPickedWeek;
window.applyCashflowOverrides = applyCashflowOverrides;
window.openStockHub = openStockHub;
window.showStockForDate = showStockForDate;
window.applyStockChartPeriod = applyStockChartPeriod;
window.toggleStockChartTable = toggleStockChartTable;
window.toggleStockDateResults = toggleStockDateResults;
window.applyStockDateSearch = applyStockDateSearch;
window.openSuppliersHub = openSuppliersHub;
window.openSuppliersRanking = openSuppliersRanking;
window.openSupplierDetail = openSupplierDetail;
window.applySupplierDetailSearch = applySupplierDetailSearch;
window.openSuppliersDemandHub = openSuppliersDemandHub;
window.applySuppliersDemandPeriod = applySuppliersDemandPeriod;
window.openReorderHub = openReorderHub;
window.applyReorderFilter = applyReorderFilter;
window.applyReorderSearch = applyReorderSearch;
window.openReorderProductModal = openReorderProductModal;
window.setReorderSort = setReorderSort;
window.toggleReorderQtyForm = toggleReorderQtyForm;
window.cancelReorderQty = cancelReorderQty;
window.confirmReorderQty = confirmReorderQty;
window.cartRemoveFromRow = cartRemoveFromRow;
window.toggleReorderSupplierPanel = toggleReorderSupplierPanel;
window.toggleReorderSupplier = toggleReorderSupplier;
window.selectAllReorderSuppliers = selectAllReorderSuppliers;
window.clearReorderSuppliers = clearReorderSuppliers;
window.applyReorderStockFilter = applyReorderStockFilter;
window.toggleReorderStatusPanel = toggleReorderStatusPanel;
window.toggleReorderStatus = toggleReorderStatus;
window.selectAllReorderStatuses = selectAllReorderStatuses;
window.clearReorderStatuses = clearReorderStatuses;
window.toggleModalCartQty = toggleModalCartQty;
window.cancelModalCartQty = cancelModalCartQty;
window.confirmModalCartQty = confirmModalCartQty;
window.openOrderCart = openOrderCart;
window.closeOrderCart = closeOrderCart;
window.setCartTab = setCartTab;
window.toggleCartCheck = toggleCartCheck;
window.cartRemoveItem = cartRemoveItem;
window.sendCartOrder = sendCartOrder;
window.copyCartMessage = copyCartMessage;
window.removeSelectedOrdered = removeSelectedOrdered;
window.toggleCartSupplierPanel = toggleCartSupplierPanel;
window.toggleCartSupplier = toggleCartSupplier;
window.selectAllCartSuppliers = selectAllCartSuppliers;
window.clearCartSuppliers = clearCartSuppliers;
window.toggleCartSelectAllVisible = toggleCartSelectAllVisible;
window.resolveConfirmModal = resolveConfirmModal;

updateCartBadge();
initAuth();
