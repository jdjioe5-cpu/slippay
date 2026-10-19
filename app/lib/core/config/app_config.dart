/// Runtime config, injected at build via --dart-define-from-file=config/<flavor>.json.
/// Every environment-specific value is derived from a single source (the flavor),
/// ensuring consistent defaults when flags or defines are omitted.
class AppConfig {
  const AppConfig({
    this.flavorOverride,
    this.chainOverride,
    this.stellarNetworkOverride,
    this.sorobanRpcOverride,
    this.horizonUrlOverride,
    this.networkPassphraseOverride,
    this.rpIdOverride,
    this.apiBaseOverride,
    this.sentryDsnOverride,
  });

  final String? flavorOverride;
  final String? chainOverride;
  final String? stellarNetworkOverride;
  final String? sorobanRpcOverride;
  final String? horizonUrlOverride;
  final String? networkPassphraseOverride;
  final String? rpIdOverride;
  final String? apiBaseOverride;
  final String? sentryDsnOverride;

  static const String _envFlavor = String.fromEnvironment('FLAVOR');
  static const String _envChain = String.fromEnvironment('CHAIN');
  static const String _envStellarNetwork = String.fromEnvironment('STELLAR_NETWORK');
  static const String _envSorobanRpc = String.fromEnvironment('SOROBAN_RPC');
  static const String _envHorizonUrl = String.fromEnvironment('HORIZON_URL');
  static const String _envNetworkPassphrase = String.fromEnvironment('NETWORK_PASSPHRASE');
  static const String _envRpId = String.fromEnvironment('RP_ID');
  static const String _envApiBase = String.fromEnvironment('API_BASE');
  static const String _envSentryDsn = String.fromEnvironment('SENTRY_DSN');

  static const AppConfig _defaultInstance = AppConfig();

  String get flavor =>
      flavorOverride ?? (_envFlavor.isNotEmpty ? _envFlavor : 'dev');
  bool get _isFlavorProd => flavor == 'prod';

  String get chain =>
      chainOverride ?? (_envChain.isNotEmpty ? _envChain : 'stellar');

  String get stellarNetwork =>
      stellarNetworkOverride ??
      (_envStellarNetwork.isNotEmpty
          ? _envStellarNetwork
          : (_isFlavorProd ? 'PUBLIC' : 'TESTNET'));

  String get sorobanRpc =>
      sorobanRpcOverride ??
      (_envSorobanRpc.isNotEmpty
          ? _envSorobanRpc
          : (_isFlavorProd
              ? 'https://mainnet.sorobanrpc.com'
              : 'https://soroban-testnet.stellar.org'));

  String get horizonUrl =>
      horizonUrlOverride ??
      (_envHorizonUrl.isNotEmpty
          ? _envHorizonUrl
          : (_isFlavorProd
              ? 'https://horizon.stellar.org'
              : 'https://horizon-testnet.stellar.org'));

  String get networkPassphrase =>
      networkPassphraseOverride ??
      (_envNetworkPassphrase.isNotEmpty
          ? _envNetworkPassphrase
          : (_isFlavorProd
              ? 'Public Global Stellar Network ; September 2015'
              : 'Test SDF Network ; September 2015'));

  String get rpId =>
      rpIdOverride ??
      (_envRpId.isNotEmpty
          ? _envRpId
          : (_isFlavorProd ? 'app.slippay.cc' : 'localhost'));

  String get apiBase =>
      apiBaseOverride ??
      (_envApiBase.isNotEmpty
          ? _envApiBase
          : (_isFlavorProd
              ? 'https://api.slippay.cc/api'
              : 'http://localhost:54321/functions/v1/api'));

  String get sentryDsn =>
      sentryDsnOverride ?? (_envSentryDsn.isNotEmpty ? _envSentryDsn : '');

  /// A build is truly production only when flavor is 'prod' AND all
  /// production network endpoints are present (not testnet or localhost).
  bool get isProd {
    if (flavor != 'prod') return false;
    if (stellarNetwork != 'PUBLIC') return false;
    if (networkPassphrase != 'Public Global Stellar Network ; September 2015') {
      return false;
    }
    if (sorobanRpc != 'https://mainnet.sorobanrpc.com') return false;
    if (horizonUrl != 'https://horizon.stellar.org') return false;
    if (apiBase != 'https://api.slippay.cc/api') return false;
    if (rpId != 'app.slippay.cc') return false;
    return true;
  }

  /// Whether all endpoints and network settings consistently describe a single environment.
  bool get isConsistent {
    if (isProd) return true;
    if (flavor == 'dev' &&
        stellarNetwork == 'TESTNET' &&
        networkPassphrase == 'Test SDF Network ; September 2015' &&
        sorobanRpc == 'https://soroban-testnet.stellar.org' &&
        horizonUrl == 'https://horizon-testnet.stellar.org' &&
        rpId == 'localhost' &&
        apiBase == 'http://localhost:54321/functions/v1/api') {
      return true;
    }
    return false;
  }

  static const List<String> supportedChains = ['stellar', 'solana'];

  /// Validates configuration invariants at app initialization.
  void validateInvariants() {
    if (!supportedChains.contains(chain)) {
      throw StateError(
        "Unknown chain '$chain'. Supported chains: $supportedChains",
      );
    }

    if (chain == 'stellar') {
      if (stellarNetwork == 'TESTNET' &&
          networkPassphrase != 'Test SDF Network ; September 2015') {
        throw StateError(
          "Mismatched network passphrase '$networkPassphrase' for Stellar network '$stellarNetwork'",
        );
      }
      if (stellarNetwork == 'PUBLIC' &&
          networkPassphrase !=
              'Public Global Stellar Network ; September 2015') {
        throw StateError(
          "Mismatched network passphrase '$networkPassphrase' for Stellar network '$stellarNetwork'",
        );
      }
    }

    if (flavor == 'prod' && !isProd) {
      throw StateError(
        "Flavor 'prod' configured with non-production endpoints: network=$stellarNetwork, apiBase=$apiBase",
      );
    }
  }

  // --- Static accessors for backward-compatibility ---
  static String get flavor => _defaultInstance.flavor;
  static String get chain => _defaultInstance.chain;
  static String get stellarNetwork => _defaultInstance.stellarNetwork;
  static String get sorobanRpc => _defaultInstance.sorobanRpc;
  static String get horizonUrl => _defaultInstance.horizonUrl;
  static String get networkPassphrase => _defaultInstance.networkPassphrase;
  static String get rpId => _defaultInstance.rpId;
  static String get apiBase => _defaultInstance.apiBase;
  static String get sentryDsn => _defaultInstance.sentryDsn;
  static bool get isProd => _defaultInstance.isProd;

  static void validate() => _defaultInstance.validateInvariants();
}
