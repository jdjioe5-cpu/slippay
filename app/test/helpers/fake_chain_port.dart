import 'package:slippay/core/chain/chain_port.dart';

/// Fake ChainPort for headless unit and widget testing without network I/O.
class FakeChainPort implements ChainPort {
  FakeChainPort({
    this.id = ChainId.stellar,
    this.walletAddress = 'C_MOCK_TEST_WALLET_ADDRESS',
    this.validFormat = true,
    this.accountExists = true,
    this.hasUsdcTrustline = true,
    this.oneTimeHash = 'tx_mock_one_time_hash',
    this.approveHash = 'tx_mock_approve_hash',
    this.shouldThrowOnApprove = false,
    this.shouldThrowOnPay = false,
  });

  @override
  final ChainId id;
  final String walletAddress;
  final bool validFormat;
  final bool? accountExists;
  final bool? hasUsdcTrustline;
  final String oneTimeHash;
  final String approveHash;
  final bool shouldThrowOnApprove;
  final bool shouldThrowOnPay;

  int connectWalletCalls = 0;
  int checkAddressCalls = 0;
  int payOneTimeCalls = 0;
  int approveRecurringCalls = 0;

  OneTimePayArgs? lastPayArgs;
  ApproveArgs? lastApproveArgs;
  String? lastCheckedAddress;

  @override
  Future<String> connectWallet() async {
    connectWalletCalls++;
    return walletAddress;
  }

  @override
  bool isValidAddress(String address) {
    if (address.isEmpty) return false;
    if (id == ChainId.stellar) {
      return (address.startsWith('G') || address.startsWith('C')) && address.length == 56;
    }
    return address.startsWith('0x') && address.length == 42;
  }

  @override
  Future<AddressCheck> checkReceiveAddress(String address) async {
    checkAddressCalls++;
    lastCheckedAddress = address;
    return AddressCheck(
      validFormat: validFormat && isValidAddress(address),
      accountExists: accountExists,
      hasUsdcTrustline: hasUsdcTrustline,
    );
  }

  @override
  Future<PayResult> payOneTime(OneTimePayArgs args) async {
    payOneTimeCalls++;
    lastPayArgs = args;
    if (shouldThrowOnPay) {
      throw Exception('Payment simulation or submission reverted');
    }
    return PayResult(oneTimeHash);
  }

  @override
  Future<PayResult> approveRecurring(ApproveArgs args) async {
    approveRecurringCalls++;
    lastApproveArgs = args;
    if (shouldThrowOnApprove) {
      throw Exception('Mandate approval simulation or submission reverted');
    }
    return PayResult(approveHash);
  }
}
